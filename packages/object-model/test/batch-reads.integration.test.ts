import { resolve } from "node:path";

import * as schema from "@chronelle/db";
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
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EventPlanningObjectService } from "../src/object-service.js";
import { EventPlanningProjectionService } from "../src/projection-service.js";
import { ObjectRelationService } from "../src/relation-service.js";
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

describe.sequential("batched canonical reads", () => {
  it.each([1, 100, 1000, 1001])(
    "bounds retrieval queries for %i related objects",
    async (count) => {
      const db = database.connection.db;
      const ownerId = createId();
      const userId = createId();
      const workspaceId = createId();
      const rootId = createId();
      const hiddenId = createId();
      const ids = Array.from({ length: count }, () => createId());
      const firstId = ids[0];
      if (firstId === undefined)
        throw new Error("Expected a populated fixture.");
      await db.insert(users).values(
        [ownerId, userId].map((id) => ({
          id,
          identityProvider: "test",
          providerSubject: id,
          displayName: "Reader",
        })),
      );
      await db.insert(workspaces).values({
        id: workspaceId,
        displayName: "Read budget",
        createdBy: ownerId,
      });
      await db
        .insert(workspaceMembers)
        .values({ workspaceId, userId: ownerId, role: "owner" });
      await db.insert(objects).values(
        [rootId, hiddenId, ...ids].map((id) => ({
          id,
          workspaceId,
          objectType: "event" as const,
          permissionScopeId: id === hiddenId ? id : rootId,
          displayName: id === rootId ? "Context" : "Scheduled event",
          createdBy: ownerId,
        })),
      );
      await db.insert(events).values(
        [rootId, hiddenId, ...ids].map((objectId) => ({
          objectId,
          workspaceId,
          startsAt: new Date("2030-01-01T10:00:00Z"),
          timezone: "UTC",
        })),
      );
      await db.insert(resourceGrants).values({
        id: createId(),
        workspaceId,
        resourceId: rootId,
        principalId: userId,
        role: "viewer",
        grantedBy: ownerId,
      });
      await db.insert(objectRelations).values(
        [...ids, hiddenId].map((targetObjectId) => ({
          id: createId(),
          workspaceId,
          sourceObjectId: rootId,
          targetObjectId,
          relationType: "includes" as const,
          createdBy: ownerId,
        })),
      );
      let queryCount = 0;
      let pageQuery = "";
      let pageParams: unknown[] = [];
      const measured = drizzle(database.connection.sql, {
        schema,
        logger: {
          logQuery: (query, params) => {
            queryCount++;
            pageQuery = query;
            pageParams = params;
          },
        },
      });
      const reader = new EventPlanningObjectService(measured);
      const projections = new EventPlanningProjectionService(measured);
      const principal = { type: "user" as const, userId, workspaceId };

      queryCount = 0;
      const rows = await reader.listVisibleObjects(principal, ids);
      // Counts include the statement configuring the read-only snapshot.
      expect(queryCount).toBe(1 + 2 * Math.ceil(count / 1000));
      expect(rows.map(({ id }) => id)).toEqual(ids);
      expect(rows[0]).toEqual(await reader.getEvent(principal, firstId));
      expect(
        await reader.listVisibleObjects(principal, [
          firstId,
          hiddenId,
          createId(),
          firstId,
        ]),
      ).toEqual([rows[0], rows[0]]);

      queryCount = 0;
      const detail = await projections.getDetail(principal, rootId);
      expect(queryCount).toBe(
        5 + Math.ceil((count + 1) / 1000) + Math.ceil(count / 1000),
      );
      expect(detail.events.map(({ id }) => id).sort()).toEqual([...ids].sort());
      expect(detail.lockedRelationCount).toBe(1);
      expect(JSON.stringify(detail)).not.toContain(hiddenId);

      queryCount = 0;
      const relations = await new ObjectRelationService(measured).listForObject(
        principal,
        rootId,
      );
      expect(queryCount).toBe(3);
      expect(relations.items).toHaveLength(Math.min(count, 20));
      expect(relations.nextCursor === null).toBe(count <= 20);
      expect(JSON.stringify(relations)).not.toContain(hiddenId);
      expect(pageQuery).toContain("inner join lateral");
      expect(pageParams.at(-1)).toBe(21);

      queryCount = 0;
      const results = await new CanonicalObjectSearchService(measured).search(
        principal,
        { query: "Scheduled", limit: 50 },
      );
      expect(queryCount).toBe(2);
      expect(results.items.every(({ id }) => ids.includes(id))).toBe(true);
      expect(results.items).toHaveLength(Math.min(count, 50));

      // Scope changes make the same canonical rows independent root Events.
      await db
        .update(objects)
        .set({ permissionScopeId: schema.objects.id })
        .where(inArray(objects.id, ids));
      queryCount = 0;
      const roots = await reader.listEvents({ ...principal, userId: ownerId });
      expect(queryCount).toBe(3);
      expect(roots.items).toHaveLength(Math.min(count + 2, 20));
      expect(roots.items.some(({ id }) => id === hiddenId)).toBe(true);
      expect(roots.nextCursor === null).toBe(count + 2 <= 20);

      await db
        .update(objects)
        .set({ displayName: "Updated schedule", version: 2 })
        .where(eq(objects.id, firstId));
      expect(
        (
          await reader.listVisibleObjects({ ...principal, userId: ownerId }, [
            firstId,
          ])
        )[0],
      ).toMatchObject({
        id: firstId,
        displayName: "Updated schedule",
        version: 2,
      });
      expect(await reader.listVisibleObjects(principal, ids)).toEqual([]);
      queryCount = 0;
      expect(await reader.listVisibleObjects(principal, [])).toEqual([]);
      expect(queryCount).toBe(0);
    },
  );
});
