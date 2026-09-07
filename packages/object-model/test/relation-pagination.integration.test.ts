import { resolve } from "node:path";
import { AuthorizationDeniedError } from "@chronelle/authorization";
import {
  createId,
  events,
  objects,
  objectRelations,
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
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../src/cursor.js";
import { InvalidObjectStateError } from "../src/errors.js";
import { ObjectRelationService } from "../src/relation-service.js";

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

async function fixture(count = 25, hiddenCount = 301) {
  const db = database.connection.db;
  const ownerId = createId();
  const userId = createId();
  const workspaceId = createId();
  const rootId = createId();
  const ids = Array.from({ length: count }, () => createId());
  const hiddenIds = Array.from({ length: hiddenCount }, () => createId());
  const hidden = new Set(hiddenIds);
  await db.insert(users).values(
    [ownerId, userId].map((id) => ({
      id,
      identityProvider: "test",
      providerSubject: id,
      displayName: "Relation reader",
    })),
  );
  await db.insert(workspaces).values({
    id: workspaceId,
    createdBy: ownerId,
    displayName: "Relation pages",
  });
  await db
    .insert(workspaceMembers)
    .values({ workspaceId, userId: ownerId, role: "owner" });
  await db.insert(objects).values(
    [rootId, ...ids, ...hiddenIds].map((id) => ({
      id,
      workspaceId,
      permissionScopeId: hidden.has(id) ? id : rootId,
      objectType: "event" as const,
      displayName: "Canonical endpoint",
      createdBy: ownerId,
    })),
  );
  await db.insert(events).values(
    [rootId, ...ids, ...hiddenIds].map((objectId) => ({
      objectId,
      workspaceId,
    })),
  );
  const grantId = createId();
  await db.insert(resourceGrants).values({
    id: grantId,
    workspaceId,
    resourceId: rootId,
    principalId: userId,
    role: "viewer",
    grantedBy: ownerId,
  });
  const links = [...ids, ...hiddenIds].map((id, index) => ({
    id: createId(),
    workspaceId,
    sourceObjectId: index % 2 === 0 ? rootId : id,
    targetObjectId: index % 2 === 0 ? id : rootId,
    relationType:
      index % 2 === 0 ? ("includes" as const) : ("related_to" as const),
    metadata: { note: hidden.has(id) ? "Private link" : "Visible link" },
    createdBy: ownerId,
  }));
  await db.insert(objectRelations).values(links);
  return {
    rootId,
    ids,
    hiddenIds,
    grantId,
    visible: links.slice(0, count).reverse(),
    hidden: links.slice(count).reverse(),
    principal: { type: "user" as const, userId, workspaceId },
    owner: { type: "user" as const, userId: ownerId, workspaceId },
    reader: new ObjectRelationService(db),
  };
}

describe.sequential("active relation pagination", () => {
  it("fills bounded pages after visibility filtering, in both directions", async () => {
    const { reader, principal, rootId, visible, hidden } = await fixture();
    const first = await reader.listForObject(principal, rootId);
    expect(first.items.map(({ id }) => id)).toEqual(
      visible.slice(0, 20).map(({ id }) => id),
    );
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(
      first.items.some(({ sourceObjectId }) => sourceObjectId === rootId),
    ).toBe(true);
    expect(
      first.items.some(({ targetObjectId }) => targetObjectId === rootId),
    ).toBe(true);
    const rest = await reader.listForObject(principal, rootId, {
      cursor: first.nextCursor ?? undefined,
    });
    expect(rest.items.map(({ id }) => id)).toEqual(
      visible.slice(20).map(({ id }) => id),
    );
    expect(rest.nextCursor).toBeNull();
    const serialized = JSON.stringify([first, rest]);
    expect(serialized).not.toContain("Private link");
    expect(hidden.some(({ id }) => serialized.includes(id))).toBe(false);
  });

  it("walks filtered pages and finds an old inclusion without scanning client pages", async () => {
    const { reader, principal, rootId, visible, hiddenIds } = await fixture(9);
    for (const direction of ["both", "incoming", "outgoing"] as const) {
      const found: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await reader.listForObject(principal, rootId, {
          direction,
          limit: 2,
          cursor,
        });
        expect(page.items.length).toBeGreaterThan(0);
        expect(page.items.length).toBeLessThanOrEqual(2);
        found.push(...page.items.map(({ id }) => id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined && found.length < 12);
      const expected = visible.filter(
        (link) =>
          direction === "both" ||
          (direction === "outgoing"
            ? link.sourceObjectId === rootId
            : link.targetObjectId === rootId),
      );
      expect(found).toEqual(expected.map(({ id }) => id));
      expect(cursor).toBeUndefined();
    }
    const oldest = visible.at(-1);
    if (!oldest) throw new Error("Expected a link");
    const exact = await reader.listForObject(principal, rootId, {
      direction: "outgoing",
      relationType: "includes",
      otherObjectId: oldest.targetObjectId,
      limit: 1,
    });
    expect(exact.items.map(({ id }) => id)).toEqual([oldest.id]);
    expect(exact.nextCursor).toBeNull();
    expect(
      (
        await reader.listForObject(principal, rootId, {
          relationType: "related_to",
        })
      ).items.map(({ id }) => id),
    ).toEqual(
      visible
        .filter(({ relationType }) => relationType === "related_to")
        .map(({ id }) => id),
    );
    for (const otherObjectId of [hiddenIds[0], createId()]) {
      expect(
        await reader.listForObject(principal, rootId, { otherObjectId }),
      ).toEqual({
        items: [],
        nextCursor: null,
      });
    }
  });

  it("rechecks scopes, direct grants, expiry and deleted endpoints between pages", async () => {
    const { reader, principal, rootId, visible } = await fixture(6, 0);
    const db = database.connection.db;
    const first = await reader.listForObject(principal, rootId, { limit: 1 });
    const remaining = visible.slice(1);
    const otherId = (link: (typeof visible)[number]) =>
      link.sourceObjectId === rootId
        ? link.targetObjectId
        : link.sourceObjectId;
    await db
      .update(objects)
      .set({ permissionScopeId: objects.id })
      .where(inArray(objects.id, remaining.map(otherId)));
    const grants = remaining.map((link) => ({
      id: createId(),
      workspaceId: principal.workspaceId,
      resourceId: otherId(link),
      principalId: principal.userId,
      role: "viewer" as const,
      grantedBy: link.createdBy,
    }));
    await db.insert(resourceGrants).values(grants);
    const [revoked, expired, deleted] = grants;
    if (!revoked || !expired || !deleted) throw new Error("Expected grants");
    await db.delete(resourceGrants).where(eq(resourceGrants.id, revoked.id));
    await db
      .update(resourceGrants)
      .set({ createdAt: new Date(0), expiresAt: new Date(1) })
      .where(eq(resourceGrants.id, expired.id));
    await db
      .update(objects)
      .set({ deletedAt: new Date() })
      .where(eq(objects.id, deleted.resourceId));
    const page = await reader.listForObject(principal, rootId, {
      cursor: first.nextCursor ?? undefined,
    });
    expect(page.items.map(({ id }) => id)).toEqual(
      remaining.slice(3).map(({ id }) => id),
    );
    expect(page.nextCursor).toBeNull();
  });

  it("continues after an unlinked boundary without deleting canonical endpoints", async () => {
    const { reader, owner, rootId, visible } = await fixture(3, 0);
    const first = await reader.listForObject(owner, rootId, { limit: 1 });
    const boundary = first.items[0];
    if (!boundary) throw new Error("Expected a boundary");
    const deletion = await reader.softDelete(
      { principal: owner, requestId: createId() },
      boundary.id,
      boundary.version,
    );
    expect(deletion.version).toBe(2);
    const rest = await reader.listForObject(owner, rootId, {
      cursor: first.nextCursor ?? undefined,
    });
    expect(rest.items.map(({ id }) => id)).toEqual(
      visible.slice(1).map(({ id }) => id),
    );
    const endpoints = await database.connection.db
      .select()
      .from(objects)
      .where(
        inArray(objects.id, [boundary.sourceObjectId, boundary.targetObjectId]),
      );
    expect(endpoints.every(({ deletedAt }) => deletedAt === null)).toBe(true);
    await reader.recover(
      { principal: owner, requestId: createId() },
      boundary.id,
      2,
    );
    expect((await reader.listForObject(owner, rootId)).items[0]).toMatchObject({
      id: boundary.id,
      version: 3,
    });
    expect(
      (
        await reader.listForObject(owner, rootId, {
          cursor: first.nextCursor ?? undefined,
        })
      ).items,
    ).toEqual(rest.items);
  });

  it("rejects malformed positions and positions reused in another query context", async () => {
    const { reader, principal, owner, rootId, ids } = await fixture(3, 0);
    const first = await reader.listForObject(principal, rootId, { limit: 1 });
    if (!first.nextCursor || !ids[0])
      throw new Error("Expected a cursor and endpoint");
    for (const input of [
      { direction: "incoming" as const },
      { relationType: "includes" as const },
      { otherObjectId: ids[0] },
    ]) {
      await expect(
        reader.listForObject(principal, rootId, {
          ...input,
          cursor: first.nextCursor,
        }),
      ).rejects.toThrow(InvalidObjectStateError);
    }
    for (const [actor, id] of [
      [owner, rootId],
      [{ ...principal, workspaceId: createId() }, rootId],
      [principal, ids[0]],
    ] as const) {
      await expect(
        reader.listForObject(actor, id, { cursor: first.nextCursor }),
      ).rejects.toThrow(InvalidObjectStateError);
    }
    const decoded = decodeCursor(first.nextCursor) as Record<string, unknown>;
    for (const cursor of [
      "a",
      "e30",
      encodeCursor({ ...decoded, formatVersion: 2 }),
      encodeCursor({ ...decoded, id: "bad" }),
      encodeCursor({ ...decoded, extra: true }),
    ]) {
      await expect(
        reader.listForObject(principal, rootId, { cursor }),
      ).rejects.toThrow(InvalidObjectStateError);
    }
    // A position is not a credential, including a forged but valid boundary.
    await database.connection.db
      .delete(resourceGrants)
      .where(eq(resourceGrants.principalId, principal.userId));
    await expect(
      reader.listForObject(principal, rootId, {
        cursor: encodeCursor({ ...decoded, id: createId() }),
      }),
    ).rejects.toThrow(AuthorizationDeniedError);
  });

  it("rejects unavailable starting objects and ignores unreadable incoming sources", async () => {
    const { reader, principal, rootId, hiddenIds, grantId } = await fixture(
      1,
      2,
    );
    expect(
      (await reader.listForObject(principal, rootId)).nextCursor,
    ).toBeNull();
    await expect(
      reader.listForObject({ ...principal, workspaceId: createId() }, rootId),
    ).rejects.toThrow(AuthorizationDeniedError);
    await expect(
      reader.listForObject(principal, hiddenIds[0] ?? createId()),
    ).rejects.toThrow(AuthorizationDeniedError);
    await database.connection.db
      .delete(resourceGrants)
      .where(eq(resourceGrants.id, grantId));
    await expect(reader.listForObject(principal, rootId)).rejects.toThrow(
      AuthorizationDeniedError,
    );
  });
});
