import { resolve } from "node:path";
import { Buffer } from "node:buffer";
import {
  createId,
  objects,
  resourceGrants,
  users,
  workspaceMembers,
  workspaces,
} from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@chronelle/db";
import { InvalidObjectStateError } from "../src/errors.js";
import { CanonicalObjectSearchService } from "../src/search-service.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
});
afterAll(async () => {
  await database?.close();
});

async function fixture(visibleCount = 3, hiddenCount = 550) {
  const db = database.connection.db;
  const ownerId = createId();
  const userId = createId();
  const workspaceId = createId();
  const scopeId = createId();
  const visibleIds = Array.from({ length: visibleCount }, () => createId());
  const hiddenIds = Array.from({ length: hiddenCount }, () => createId());
  await db.insert(users).values(
    [ownerId, userId].map((id) => ({
      id,
      identityProvider: "test",
      providerSubject: id,
      displayName: "Search user",
    })),
  );
  await db.insert(workspaces).values({
    id: workspaceId,
    createdBy: ownerId,
    displayName: "Search workspace",
  });
  await db
    .insert(workspaceMembers)
    .values({ workspaceId, userId: ownerId, role: "owner" });
  await db.insert(objects).values({
    id: scopeId,
    workspaceId,
    permissionScopeId: scopeId,
    objectType: "event",
    displayName: "Context",
    createdBy: ownerId,
  });
  await db.insert(objects).values([
    ...visibleIds.map((id) => ({
      id,
      workspaceId,
      permissionScopeId: scopeId,
      objectType: "task" as const,
      displayName: "Searchable task",
      createdBy: ownerId,
      updatedAt: new Date("2030-01-01T00:00:00Z"),
    })),
    ...hiddenIds.map((id) => ({
      id,
      workspaceId,
      permissionScopeId: id,
      objectType: "task" as const,
      displayName: "Searchable task",
      createdBy: ownerId,
      updatedAt: new Date("2030-01-02T00:00:00Z"),
    })),
  ]);
  await db.insert(resourceGrants).values({
    id: createId(),
    workspaceId,
    resourceId: scopeId,
    principalId: userId,
    role: "viewer",
    grantedBy: ownerId,
  });
  return {
    ownerId,
    scopeId,
    visibleIds,
    hiddenIds,
    principal: { type: "user" as const, userId, workspaceId },
  };
}

describe.sequential("visible search pagination", () => {
  it("finds accessible matches after more than 500 private candidates", async () => {
    const { principal, visibleIds } = await fixture();
    let queryCount = 0;
    const measured = drizzle(database.connection.sql, {
      schema,
      logger: {
        logQuery() {
          queryCount += 1;
        },
      },
    });
    const page = await new CanonicalObjectSearchService(measured).search(
      principal,
      { query: "Searchable", limit: 20 },
    );
    expect(queryCount).toBe(2);
    expect(page.items.map(({ id }) => id)).toEqual(visibleIds);
    expect(page.nextCursor).toBeNull();
  });

  it("walks tied ranks and times without duplicates across sparse-access pages", async () => {
    const { principal, visibleIds, hiddenIds } = await fixture(7);
    const search = new CanonicalObjectSearchService(database.connection.db);
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await search.search(principal, {
        query: "Searchable",
        limit: 2,
        cursor,
      });
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.items.length).toBeLessThanOrEqual(2);
      expect(hiddenIds.some((id) => JSON.stringify(page).includes(id))).toBe(
        false,
      );
      ids.push(...page.items.map(({ id }) => id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined && ids.length < 10);
    expect(ids).toEqual(visibleIds);
    expect(cursor).toBeUndefined();
  });

  it("preserves sub-millisecond positions when the boundary is soft-deleted", async () => {
    const { principal, visibleIds } = await fixture(3, 0);
    const db = database.connection.db;
    for (const [index, id] of visibleIds.entries()) {
      await db
        .update(objects)
        .set({
          updatedAt: sql`${`2030-01-01T00:00:00.00000${index + 1}Z`}::timestamptz`,
        })
        .where(eq(objects.id, id));
    }
    const search = new CanonicalObjectSearchService(db);
    const first = await search.search(principal, {
      query: "Searchable",
      limit: 1,
    });
    expect(first.items.map(({ id }) => id)).toEqual([visibleIds[2]]);
    const firstItem = first.items[0];
    if (!firstItem || !first.nextCursor)
      throw new Error("Expected a first page");
    await db
      .update(objects)
      .set({ deletedAt: new Date() })
      .where(eq(objects.id, firstItem.id));
    const rest = await search.search(principal, {
      query: "Searchable",
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(rest.items.map(({ id }) => id)).toEqual([
      visibleIds[1],
      visibleIds[0],
    ]);
    expect(rest.nextCursor).toBeNull();
  });

  it("continues from a higher rank into lower-ranked matches", async () => {
    const { principal, visibleIds } = await fixture(3, 0);
    const firstId = visibleIds[0];
    if (!firstId) throw new Error("Expected a match");
    await database.connection.db
      .update(objects)
      .set({ displayName: "Searchable Searchable Searchable" })
      .where(eq(objects.id, firstId));
    const search = new CanonicalObjectSearchService(database.connection.db);
    const first = await search.search(principal, {
      query: "Searchable",
      limit: 1,
    });
    expect(first.items.map(({ id }) => id)).toEqual([firstId]);
    const rest = await search.search(principal, {
      query: "Searchable",
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(rest.items.map(({ id }) => id)).toEqual(visibleIds.slice(1));
    expect(rest.nextCursor).toBeNull();
  });

  it("rechecks grants and deletions on every page without exposing private totals", async () => {
    const { principal, scopeId, visibleIds } = await fixture(3, 0);
    const db = database.connection.db;
    const search = new CanonicalObjectSearchService(db);
    const first = await search.search(principal, {
      query: "Searchable",
      limit: 1,
    });
    const input = {
      query: "Searchable",
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    };
    await db
      .update(objects)
      .set({ deletedAt: new Date() })
      .where(inArray(objects.id, visibleIds.slice(1)));
    expect(await search.search(principal, input)).toEqual({
      items: [],
      nextCursor: null,
    });
    await db
      .update(objects)
      .set({ deletedAt: null })
      .where(inArray(objects.id, visibleIds));
    await db
      .update(resourceGrants)
      .set({ expiresAt: new Date() })
      .where(eq(resourceGrants.resourceId, scopeId));
    expect(await search.search(principal, input)).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("rejects malformed and mismatched cursors without granting access to forged positions", async () => {
    const { principal, ownerId, hiddenIds } = await fixture(3, 1);
    const search = new CanonicalObjectSearchService(database.connection.db);
    const first = await search.search(principal, {
      query: "Searchable",
      limit: 1,
    });
    if (!first.nextCursor) throw new Error("Expected a cursor");
    const cursor = first.nextCursor;
    const payload = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    const encode = (changes: Record<string, unknown>) =>
      Buffer.from(JSON.stringify({ ...payload, ...changes })).toString(
        "base64url",
      );
    const input = { query: "Searchable", limit: 20, cursor };
    for (const invalid of [
      "",
      "!",
      "a".repeat(2049),
      "bm90LWpzb24",
      encode({ formatVersion: 2 }),
      encode({ rank: 1e100 }),
      encode({ updatedAt: "2030-02-30T00:00:00.000000Z" }),
      encode({ updatedAt: "0000-01-01T00:00:00.000000Z" }),
      encode({ extra: true }),
    ]) {
      await expect(
        search.search(principal, { ...input, cursor: invalid }),
      ).rejects.toBeInstanceOf(InvalidObjectStateError);
    }
    for (const changed of [
      { query: "Other" },
      { objectType: "task" as const },
    ]) {
      await expect(
        search.search(principal, { ...input, ...changed }),
      ).rejects.toBeInstanceOf(InvalidObjectStateError);
    }
    for (const changed of [{ userId: ownerId }, { workspaceId: createId() }]) {
      await expect(
        search.search({ ...principal, ...changed }, input),
      ).rejects.toBeInstanceOf(InvalidObjectStateError);
    }
    const forged = await search.search(principal, {
      ...input,
      cursor: encode({
        id: hiddenIds[0],
        rank: 100,
        updatedAt: "2099-01-01T00:00:00.000000Z",
      }),
    });
    expect(forged.items).toHaveLength(3);
    expect(JSON.stringify(forged)).not.toContain(hiddenIds[0]);
    const normalized = await search.search(principal, {
      ...input,
      query: "  Searchable  ",
    });
    expect(normalized.items).toHaveLength(2);
  });
});
