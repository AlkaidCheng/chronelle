import { resolve } from "node:path";
import {
  createId,
  events,
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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import type { EventListQueryInput } from "@chronelle/schemas";
import { decodeCursor, encodeCursor } from "../src/cursor.js";
import { InvalidObjectStateError } from "../src/errors.js";
import { EventPlanningObjectService } from "../src/object-service.js";

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

async function fixture(count = 23, hiddenCount = 550) {
  const db = database.connection.db;
  const ownerId = createId();
  const userId = createId();
  const workspaceId = createId();
  const ids = Array.from({ length: count }, () => createId());
  const hiddenIds = Array.from({ length: hiddenCount }, () => createId());
  await db.insert(users).values(
    [ownerId, userId].map((id) => ({
      id,
      identityProvider: "test",
      providerSubject: id,
      displayName: "Event reader",
    })),
  );
  await db.insert(workspaces).values({
    id: workspaceId,
    createdBy: ownerId,
    displayName: "Event collection",
  });
  await db
    .insert(workspaceMembers)
    .values({ workspaceId, userId: ownerId, role: "owner" });
  await db.insert(objects).values(
    [...ids, ...hiddenIds].map((id) => ({
      id,
      workspaceId,
      permissionScopeId: id,
      objectType: "event" as const,
      displayName: hiddenIds.includes(id)
        ? "A private event"
        : "Planning event",
      createdBy: ownerId,
      updatedAt: new Date("2030-01-01T00:00:00Z"),
    })),
  );
  await db
    .insert(events)
    .values(
      [...ids, ...hiddenIds].map((objectId) => ({ objectId, workspaceId })),
    );
  await db.insert(resourceGrants).values(
    ids.map((resourceId) => ({
      id: createId(),
      workspaceId,
      resourceId,
      principalId: userId,
      role: "viewer" as const,
      grantedBy: ownerId,
    })),
  );
  return {
    ownerId,
    ids,
    hiddenIds,
    principal: { type: "user" as const, userId, workspaceId },
    reader: new EventPlanningObjectService(db),
  };
}

describe.sequential("event collection pagination", () => {
  it("paginates mixed date-only and timed events without exposing private rows", async () => {
    const { reader, principal, ids, hiddenIds } = await fixture(4, 1);
    const db = database.connection.db;
    await db
      .update(events)
      .set({ startsOn: "2030-07-03" })
      .where(inArray(events.objectId, [...ids.slice(0, 2), ...hiddenIds]));
    await db
      .update(events)
      .set({ startsAt: new Date("2030-07-03T00:00:00Z") })
      .where(inArray(events.objectId, ids.slice(2, 3)));
    const found: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await reader.listEvents(principal, { limit: 1, cursor });
      found.push(...page.items.map(({ id }) => id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined && found.length <= ids.length);
    expect(found).toEqual(ids);
    expect(cursor).toBeUndefined();
  });

  it("keeps date-only events upcoming throughout the inclusive end day in their timezone", async () => {
    const { reader, principal, ids } = await fixture(3, 0);
    const [western, eastern] = ids;
    if (!western || !eastern) throw new Error("Expected calendar fixtures");
    const db = database.connection.db;
    await db
      .update(events)
      .set({
        startsOn: "2030-07-03",
        endsOn: "2030-07-12",
        timezone: "America/Los_Angeles",
      })
      .where(eq(events.objectId, western));
    await db
      .update(events)
      .set({
        startsOn: "2030-07-03",
        endsOn: "2030-07-12",
        timezone: "Asia/Tokyo",
      })
      .where(eq(events.objectId, eastern));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-07-13T06:59:59Z"));
      expect(
        (await reader.listEvents(principal, { filter: "upcoming" })).items.map(
          ({ id }) => id,
        ),
      ).toEqual([western]);
      expect(
        (await reader.listEvents(principal, { filter: "past" })).items.map(
          ({ id }) => id,
        ),
      ).toEqual([eastern]);
      expect(
        (
          await reader.listEvents(principal, { filter: "unscheduled" })
        ).items.map(({ id }) => id),
      ).toEqual(ids.slice(2));
      vi.setSystemTime(new Date("2030-07-13T07:00:00Z"));
      expect(
        (await reader.listEvents(principal, { filter: "upcoming" })).items,
      ).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("enforces calendar-date integrity at the SQL boundary", async () => {
    const { ids } = await fixture(1, 0);
    const id = ids[0];
    if (!id) throw new Error("Expected event fixture");
    const db = database.connection.db;
    for (const invalid of [
      { endsOn: "2030-07-03" },
      { startsOn: "2030-07-03", endsOn: "2030-07-01" },
      { startsOn: "2030-07-03", startsAt: new Date("2030-07-03T00:00:00Z") },
      { startsOn: "10000-01-01" },
    ])
      await expect(
        db.update(events).set(invalid).where(eq(events.objectId, id)),
      ).rejects.toThrow();
  });

  it("bounds the default page after authorization even with sparse access", async () => {
    const { reader, principal, ids, hiddenIds } = await fixture();
    const page = await reader.listEvents(principal);
    expect(page).toMatchObject({
      items: ids.slice(0, 20).map((id) => ({ id })),
      nextCursor: expect.any(String),
      asOf: expect.any(String),
    });
    expect(JSON.stringify(page)).not.toContain(hiddenIds[0]);
  });

  it.each(["date", "name", "updated"] as const)(
    "walks tied %s positions without duplicates or private rows",
    async (sort) => {
      const { reader, principal, ids, hiddenIds } = await fixture(7);
      const found: string[] = [];
      let cursor: string | undefined;
      let asOf: string | undefined;
      do {
        const page = await reader.listEvents(principal, {
          sort,
          limit: 2,
          cursor,
        });
        expect(page.items.length).toBeGreaterThan(0);
        expect(page.items.length).toBeLessThanOrEqual(2);
        if (asOf !== undefined) expect(page.asOf).toBe(asOf);
        asOf = page.asOf;
        found.push(...page.items.map(({ id }) => id));
        expect(hiddenIds.some((id) => JSON.stringify(page).includes(id))).toBe(
          false,
        );
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined && found.length < 10);
      expect(found).toEqual(ids);
      expect(cursor).toBeUndefined();
    },
  );

  it.each(["date", "updated"] as const)(
    "retains %s microseconds after a deleted boundary",
    async (sort) => {
      const { reader, principal, ids } = await fixture(4, 0);
      const db = database.connection.db;
      for (const [index, id] of ids.slice(0, 3).entries()) {
        const instant = sql`${`2030-01-01T00:00:00.00000${index + 1}Z`}::timestamptz`;
        await db
          .update(events)
          .set({ startsAt: instant })
          .where(eq(events.objectId, id));
        await db
          .update(objects)
          .set({ updatedAt: instant })
          .where(eq(objects.id, id));
      }
      const expected = sort === "date" ? ids : [ids[2], ids[1], ids[0], ids[3]];
      const first = await reader.listEvents(principal, { sort, limit: 1 });
      expect(first.items.map(({ id }) => id)).toEqual(expected.slice(0, 1));
      const boundary = first.items[0];
      if (!boundary || !first.nextCursor)
        throw new Error("Expected a boundary");
      await db
        .update(objects)
        .set({ deletedAt: new Date() })
        .where(eq(objects.id, boundary.id));
      const rest = await reader.listEvents(principal, {
        sort,
        limit: 10,
        cursor: first.nextCursor,
      });
      expect(rest.items.map(({ id }) => id)).toEqual(expected.slice(1));
      expect(rest.nextCursor).toBeNull();
    },
  );

  it("orders names deterministically and treats wildcard characters literally", async () => {
    const { reader, principal, ids } = await fixture(5, 0);
    const names = [
      "Zebra",
      "alpha",
      "Alpha",
      "Tea 100%_\\",
      "\u8336".repeat(240),
    ];
    for (const [index, id] of ids.entries()) {
      await database.connection.db
        .update(objects)
        .set({ displayName: names[index] })
        .where(eq(objects.id, id));
    }
    const page = await reader.listEvents(principal, { sort: "name", limit: 2 });
    expect(page.items.map(({ id }) => id)).toEqual([ids[1], ids[2]]);
    const rest = await reader.listEvents(principal, {
      sort: "name",
      cursor: page.nextCursor ?? undefined,
    });
    expect(rest.items.map(({ id }) => id)).toEqual([ids[3], ids[0], ids[4]]);
    expect(
      (await reader.listEvents(principal, { query: " 100%_\\ " })).items.map(
        ({ id }) => id,
      ),
    ).toEqual([ids[3]]);
    expect(
      (await reader.listEvents(principal, { query: " ALPHA " })).items.map(
        ({ id }) => id,
      ),
    ).toEqual([ids[1], ids[2]]);
    // Long Unicode and escaped control characters must produce usable cursors.
    for (const name of ["\u8336".repeat(240), `a${"\u0001".repeat(239)}`]) {
      await database.connection.db
        .update(objects)
        .set({ displayName: name })
        .where(inArray(objects.id, ids));
      const first = await reader.listEvents(principal, {
        sort: "name",
        limit: 1,
      });
      expect(first.nextCursor?.length).toBeLessThanOrEqual(4096);
      expect(
        (
          await reader.listEvents(principal, {
            sort: "name",
            cursor: first.nextCursor ?? undefined,
          })
        ).items.map(({ id }) => id),
      ).toEqual(ids.slice(1));
    }
  });

  it("freezes period membership but rechecks grant expiry on later pages", async () => {
    const { reader, principal, ids } = await fixture(5, 0);
    const [past, ongoing, boundary, future] = ids;
    if (!past || !ongoing || !boundary || !future)
      throw new Error("Expected dated fixtures");
    const db = database.connection.db;
    const asOf = new Date(Date.now() - 60_000);
    const frozenTime = asOf.toISOString().replace("Z", "000Z");
    await db
      .update(events)
      .set({ startsAt: new Date(asOf.getTime() - 1000) })
      .where(inArray(events.objectId, [past, ongoing]));
    await db
      .update(events)
      .set({ endsAt: new Date(asOf.getTime() + 86_400_000) })
      .where(eq(events.objectId, ongoing));
    await db
      .update(events)
      .set({ startsAt: asOf })
      .where(eq(events.objectId, boundary));
    await db
      .update(events)
      .set({ startsAt: new Date(asOf.getTime() + 86_400_000) })
      .where(eq(events.objectId, future));
    // A valid cursor can choose a position and period clock, never permissions.
    const upcoming = await reader.listEvents(principal, {
      sort: "name",
      filter: "upcoming",
      limit: 1,
    });
    const envelope = decodeCursor(upcoming.nextCursor ?? "") as Record<
      string,
      unknown
    >;
    const cursor = encodeCursor({ ...envelope, asOf: frozenTime });
    const page = await reader.listEvents(principal, {
      sort: "name",
      filter: "upcoming",
      cursor,
    });
    expect(page.asOf).toBe(frozenTime);
    expect(page.items.map(({ id }) => id)).toEqual([boundary, future]);
    expect(
      (await reader.listEvents(principal, { filter: "past" })).items.map(
        ({ id }) => id,
      ),
    ).toEqual([past, boundary]);
    expect(
      (await reader.listEvents(principal, { filter: "unscheduled" })).items.map(
        ({ id }) => id,
      ),
    ).toEqual(ids.slice(4));
    await db
      .update(resourceGrants)
      .set({ expiresAt: new Date() })
      .where(eq(resourceGrants.workspaceId, principal.workspaceId));
    expect(
      (
        await reader.listEvents(principal, {
          sort: "name",
          filter: "upcoming",
          cursor,
        })
      ).items,
    ).toEqual([]);
  });

  it("excludes scoped children, tombstones, unrelated users and other workspaces", async () => {
    const { reader, principal, ids, ownerId } = await fixture(3, 0);
    const [root, child, deleted] = ids;
    if (!root || !child || !deleted) throw new Error("Expected scope fixtures");
    const db = database.connection.db;
    await db
      .update(objects)
      .set({ permissionScopeId: root })
      .where(eq(objects.id, child));
    await db
      .update(objects)
      .set({ deletedAt: new Date() })
      .where(eq(objects.id, deleted));
    for (const userId of [principal.userId, ownerId]) {
      expect(
        (await reader.listEvents({ ...principal, userId })).items.map(
          ({ id }) => id,
        ),
      ).toEqual([root]);
    }
    expect(
      (await reader.listEvents({ ...principal, userId: createId() })).items,
    ).toEqual([]);
    // From another workspace the grantee still lists the share (it follows
    // the account), while the member lists nothing of it.
    expect(
      (
        await reader.listEvents({ ...principal, workspaceId: createId() })
      ).items.map(({ id }) => id),
    ).toEqual([root]);
    expect(
      (
        await reader.listEvents({
          ...principal,
          userId: ownerId,
          workspaceId: createId(),
        })
      ).items,
    ).toEqual([]);
  });

  it("rejects malformed and mismatched cursors without trusting their positions", async () => {
    const { reader, principal, ids } = await fixture(3, 1);
    const first = await reader.listEvents(principal, { limit: 1 });
    if (!first.nextCursor) throw new Error("Expected a cursor");
    for (const options of [
      { query: "different" },
      { filter: "past" },
      { sort: "name" },
    ] satisfies EventListQueryInput[]) {
      await expect(
        reader.listEvents(principal, { ...options, cursor: first.nextCursor }),
      ).rejects.toBeInstanceOf(InvalidObjectStateError);
    }
    for (const changed of [
      { ...principal, userId: createId() },
      { ...principal, workspaceId: createId() },
    ]) {
      await expect(
        reader.listEvents(changed, { cursor: first.nextCursor }),
      ).rejects.toBeInstanceOf(InvalidObjectStateError);
    }
    const payload = decodeCursor(first.nextCursor) as Record<string, unknown>;
    for (const cursor of [
      "e30",
      "A",
      encodeCursor({ ...payload, startsAt: "0000-01-01T00:00:00.000000Z" }),
      encodeCursor({ ...payload, extra: true }),
    ]) {
      await expect(
        reader.listEvents(principal, { cursor }),
      ).rejects.toBeInstanceOf(InvalidObjectStateError);
    }
    const forged = encodeCursor({
      ...payload,
      id: "00000000-0000-0000-0000-000000000000",
      name: "",
    });
    expect(
      (await reader.listEvents(principal, { cursor: forged })).items.map(
        ({ id }) => id,
      ),
    ).toEqual(ids);
  });
});
