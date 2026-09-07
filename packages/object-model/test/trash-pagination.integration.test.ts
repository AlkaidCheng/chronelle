import { resolve } from "node:path";
import * as schema from "@chronelle/db";
import {
  createId,
  events,
  tasks,
  objects,
  users,
  workspaces,
  workspaceMembers,
  resourceGrants,
} from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../src/cursor.js";
import { InvalidObjectStateError } from "../src/errors.js";
import { ObjectRecoveryService } from "../src/recovery-service.js";

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

async function fixture(count = 25, hiddenCount = 550) {
  const db = database.connection.db;
  const ownerId = createId(),
    userId = createId(),
    workspaceId = createId(),
    scopeId = createId();
  await db.insert(users).values(
    [ownerId, userId].map((id) => ({
      id,
      identityProvider: "test",
      providerSubject: id,
      displayName: "Recovery reader",
    })),
  );
  await db.insert(workspaces).values({
    id: workspaceId,
    createdBy: ownerId,
    displayName: "Recovery pages",
  });
  await db
    .insert(workspaceMembers)
    .values({ workspaceId, userId: ownerId, role: "owner" });
  const rows = Array.from({ length: count + hiddenCount }, (_, index) => {
    const id = createId();
    return {
      id,
      workspaceId,
      permissionScopeId: index < count ? scopeId : id,
      objectType: index % 2 === 0 ? ("event" as const) : ("task" as const),
      displayName: index < count ? "Shared tombstone" : "Private tombstone",
      createdBy: ownerId,
      deletedAt: new Date("2030-01-01T00:00:00Z"),
    };
  });
  await db.insert(objects).values([
    {
      id: scopeId,
      workspaceId,
      permissionScopeId: scopeId,
      objectType: "event",
      displayName: "Recovery scope",
      createdBy: ownerId,
    },
    ...rows,
  ]);
  await db
    .insert(events)
    .values(
      [
        scopeId,
        ...rows
          .filter((row) => row.objectType === "event")
          .map((row) => row.id),
      ].map((objectId) => ({ objectId, workspaceId })),
    );
  const taskRows = rows.filter((row) => row.objectType === "task");
  if (taskRows.length)
    await db
      .insert(tasks)
      .values(taskRows.map((row) => ({ objectId: row.id, workspaceId })));
  const grantId = createId();
  await db.insert(resourceGrants).values({
    id: grantId,
    workspaceId,
    resourceId: scopeId,
    principalId: userId,
    role: "owner",
    grantedBy: ownerId,
  });
  return {
    reader: new ObjectRecoveryService(db),
    principal: { type: "user" as const, userId, workspaceId },
    owner: { type: "user" as const, userId: ownerId, workspaceId },
    scopeId,
    grantId,
    visible: rows.slice(0, count).reverse(),
    hidden: rows.slice(count),
  };
}

describe.sequential("Trash cursor pagination", () => {
  it("returns an opaque continuation bound to its query", async () => {
    const { reader, principal } = await fixture(3, 0);
    const page = await reader.list(principal, { limit: 1 });
    expect(page).toHaveProperty("nextCursor", expect.any(String));
  });

  it("filters 550 private tombstones before bounded pages and keeps tied deletion times stable", async () => {
    const { principal, visible, hidden, scopeId } = await fixture();
    const queries: { sql: string; params: unknown[] }[] = [];
    const reader = new ObjectRecoveryService(
      drizzle(database.connection.sql, {
        schema,
        logger: {
          logQuery: (sql, params) => {
            queries.push({ sql, params });
          },
        },
      }),
    );
    for (const objectType of [undefined, "event", "task"] as const) {
      const found: string[] = [];
      let cursor: string | undefined;
      do {
        queries.length = 0;
        const page = await reader.list(principal, {
          limit: 7,
          objectType,
          cursor,
        });
        expect(queries).toHaveLength(2);
        expect(queries.at(-1)?.params.at(-1)).toBe(8);
        expect(page.items.length).toBeGreaterThan(0);
        expect(page.items.length).toBeLessThanOrEqual(7);
        expect(Object.keys(page).sort()).toEqual(["items", "nextCursor"]);
        const serialized = JSON.stringify(page);
        expect(serialized).not.toContain("Private tombstone");
        expect(hidden.some((row) => serialized.includes(row.id))).toBe(false);
        found.push(...page.items.map((row) => row.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined && found.length < 30);
      expect(found).toEqual(
        visible
          .filter(
            (row) => objectType === undefined || row.objectType === objectType,
          )
          .map((row) => row.id),
      );
      expect(cursor).toBeUndefined();
    }
    expect(
      (await reader.list(principal, { scopeId, limit: 100 })).items.map(
        (row) => row.id,
      ),
    ).toEqual(visible.map((row) => row.id));
    expect(await reader.list(principal, { scopeId: createId() })).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(
      await reader.list({ ...principal, workspaceId: createId() }),
    ).toEqual({ items: [], nextCursor: null });
  });

  it("returns an empty terminal page when every tombstone is private", async () => {
    const { reader, principal } = await fixture(0);
    expect(await reader.list(principal)).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("binds cursors to user, workspace, type and scope, but permits page-size changes", async () => {
    const { reader, principal, owner, visible, scopeId } = await fixture(4, 0);
    const first = await reader.list(principal, { limit: 1 });
    if (!first.nextCursor) throw new Error("Expected continuation");
    for (const [actor, filters] of [
      [owner, {}],
      [{ ...principal, workspaceId: createId() }, {}],
      [principal, { objectType: "task" as const }],
      [principal, { scopeId }],
    ] as const) {
      await expect(
        reader.list(actor, { ...filters, cursor: first.nextCursor }),
      ).rejects.toThrow(InvalidObjectStateError);
    }
    const rest = await reader.list(principal, {
      limit: 100,
      cursor: first.nextCursor,
    });
    expect(rest.items.map((row) => row.id)).toEqual(
      visible.slice(1).map((row) => row.id),
    );
    expect(rest.nextCursor).toBeNull();
    const decoded = decodeCursor(first.nextCursor) as Record<string, unknown>;
    for (const cursor of [
      "a",
      "e30",
      encodeCursor({ ...decoded, context: "0".repeat(64) }),
      encodeCursor({ ...decoded, formatVersion: 2 }),
      encodeCursor({ ...decoded, id: "bad" }),
      encodeCursor({ ...decoded, extra: true }),
    ]) {
      await expect(reader.list(principal, { cursor })).rejects.toThrow(
        InvalidObjectStateError,
      );
    }
  });

  it("rechecks direct grants, scope inheritance, expiry and role changes between pages", async () => {
    const { reader, principal, owner, grantId, visible, scopeId } =
      await fixture(6, 0);
    const db = database.connection.db;
    const first = await reader.list(principal, { limit: 1 });
    const remaining = visible.slice(1);
    await db
      .update(objects)
      .set({ permissionScopeId: objects.id })
      .where(
        inArray(
          objects.id,
          remaining.map((row) => row.id),
        ),
      );
    expect(
      (await reader.list(principal, { cursor: first.nextCursor ?? undefined }))
        .items,
    ).toEqual([]);
    const grants = remaining.map((row) => ({
      id: createId(),
      workspaceId: principal.workspaceId,
      resourceId: row.id,
      principalId: principal.userId,
      role: "owner" as const,
      grantedBy: owner.userId,
    }));
    await db.insert(resourceGrants).values(grants);
    const [revoked, expired, downgraded] = grants;
    if (!revoked || !expired || !downgraded) throw new Error("Expected grants");
    await db.delete(resourceGrants).where(eq(resourceGrants.id, revoked.id));
    await db
      .update(resourceGrants)
      .set({ createdAt: new Date(0), expiresAt: new Date(1) })
      .where(eq(resourceGrants.id, expired.id));
    await db
      .update(resourceGrants)
      .set({ role: "editor" })
      .where(eq(resourceGrants.id, downgraded.id));
    const page = await reader.list(principal, {
      cursor: first.nextCursor ?? undefined,
    });
    expect(page.items.map((row) => row.id)).toEqual(
      remaining.slice(3).map((row) => row.id),
    );
    await db
      .delete(resourceGrants)
      .where(eq(resourceGrants.principalId, principal.userId));
    const decoded = decodeCursor(first.nextCursor ?? "") as Record<
      string,
      unknown
    >;
    expect(
      await reader.list(principal, {
        cursor: encodeCursor({ ...decoded, id: createId() }),
      }),
    ).toEqual({ items: [], nextCursor: null });
    // Recovery access includes a deleted canonical scope, without granting normal View.
    await db.insert(resourceGrants).values({
      id: grantId,
      workspaceId: principal.workspaceId,
      resourceId: scopeId,
      principalId: principal.userId,
      role: "owner",
      grantedBy: owner.userId,
    });
    await db
      .update(objects)
      .set({ deletedAt: new Date() })
      .where(eq(objects.id, scopeId));
    expect((await reader.list(principal)).items.map((row) => row.id)).toEqual([
      visible[0]?.id,
      scopeId,
    ]);
  });

  it("continues after its boundary leaves Trash and refreshes newly deleted objects", async () => {
    const { reader, principal, visible, scopeId } = await fixture(3, 0);
    const db = database.connection.db;
    const first = await reader.list(principal, { limit: 1 });
    const boundary = first.items[0];
    if (!boundary) throw new Error("Expected boundary");
    await db
      .update(objects)
      .set({ deletedAt: null })
      .where(eq(objects.id, boundary.id));
    const rest = await reader.list(principal, {
      cursor: first.nextCursor ?? undefined,
    });
    expect(rest.items.map((row) => row.id)).toEqual(
      visible.slice(1).map((row) => row.id),
    );
    await db
      .update(objects)
      .set({ deletedAt: new Date() })
      .where(eq(objects.id, scopeId));
    expect((await reader.list(principal)).items.map((row) => row.id)).toEqual([
      ...visible.slice(1).map((row) => row.id),
      scopeId,
    ]);
  });
});
