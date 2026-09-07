import { resolve } from "node:path";

import * as schema from "@chronelle/db";
import {
  createId,
  objects,
  resourceGrants,
  users,
  workspaceMembers,
  workspaces,
  type Role,
} from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withReadAuthorization } from "../src/authorization-transaction.js";
import {
  AuthorizationService,
  authorizationActions,
  roleAllows,
} from "../src/authorization.js";
import { DrizzleAuthorizationStore } from "../src/drizzle-authorization-store.js";

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

describe.sequential("authorization query budgets", () => {
  it.each([1, 100, 1000, 1001])(
    "evaluates %i scoped objects",
    async (count) => {
      const db = database.connection.db;
      const ownerId = createId();
      const userId = createId();
      const workspaceId = createId();
      const scopeId = createId();
      await db.insert(users).values(
        [ownerId, userId].map((id) => ({
          id,
          identityProvider: "test",
          providerSubject: id,
          displayName: "Query budget user",
        })),
      );
      await db.insert(workspaces).values({
        id: workspaceId,
        displayName: "Query budget workspace",
        createdBy: ownerId,
      });
      await db.insert(objects).values({
        id: scopeId,
        workspaceId,
        permissionScopeId: scopeId,
        objectType: "event",
        displayName: "Shared scope",
        createdBy: ownerId,
      });
      const resources = Array.from({ length: count }, () => ({
        id: createId(),
        workspaceId,
      }));
      await db.insert(objects).values(
        resources.map((resource) => ({
          ...resource,
          permissionScopeId: scopeId,
          objectType: "event" as const,
          displayName: "Scoped event",
          createdBy: ownerId,
        })),
      );
      await db.insert(resourceGrants).values({
        id: createId(),
        workspaceId,
        resourceId: scopeId,
        principalId: userId,
        role: "viewer",
        grantedBy: ownerId,
      });
      let queryCount = 0;
      const measured = drizzle(database.connection.sql, {
        schema,
        logger: { logQuery: () => queryCount++ },
      });
      const principal = { type: "user" as const, userId, workspaceId };
      const samples: number[] = [];
      for (let repetition = 0; repetition < 4; repetition++) {
        await withReadAuthorization(measured, async (_transaction, policy) => {
          queryCount = 0;
          const started = performance.now();
          const allowed = await policy.canMany(principal, "view", resources);
          for (const decision of allowed) expect(decision).toBe(true);
          const elapsedMs = performance.now() - started;
          expect(allowed).toEqual(resources.map(() => true));
          expect(queryCount).toBe(Math.ceil(count / 1000));
          if (repetition > 0) samples.push(elapsedMs);
          queryCount = 0;
          expect(await policy.canMany(principal, "recover", resources)).toEqual(
            resources.map(() => false),
          );
          expect(queryCount).toBe(Math.ceil(count / 1000));
        });
      }
      console.info(
        JSON.stringify({
          objects: count,
          queries: Math.ceil(count / 1000),
          medianMs: samples.sort((a, b) => a - b)[1],
        }),
      );
    },
  );
});

describe.sequential("batch policy parity", () => {
  it.each(["owner", "editor", "viewer"] as const)(
    "preserves %s membership and grant boundaries",
    async (role: Role) => {
      const db = database.connection.db;
      const ownerId = createId();
      const memberId = createId();
      const granteeId = createId();
      const unrelatedId = createId();
      const workspaceId = createId();
      const otherWorkspaceId = createId();
      const evaluatedAt = new Date("2030-01-02T00:00:00Z");
      const ids = Array.from({ length: 10 }, () => createId());
      const [
        root,
        child,
        ,
        stopped,
        tombstone,
        deletedScope,
        orphan,
        expired,
        boundary,
        foreign,
      ] = ids as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      await db.insert(users).values(
        [ownerId, memberId, granteeId, unrelatedId].map((id) => ({
          id,
          identityProvider: "test",
          providerSubject: id,
          displayName: "Policy user",
        })),
      );
      await db.insert(workspaces).values(
        [workspaceId, otherWorkspaceId].map((id) => ({
          id,
          createdBy: ownerId,
          displayName: "Policy workspace",
        })),
      );
      await db
        .insert(workspaceMembers)
        .values({ workspaceId, userId: memberId, role });
      const scopes = [
        root,
        root,
        child,
        stopped,
        root,
        deletedScope,
        deletedScope,
        expired,
        boundary,
        foreign,
      ];
      await db.insert(objects).values(
        ids.map((id, index) => ({
          id,
          workspaceId: id === foreign ? otherWorkspaceId : workspaceId,
          permissionScopeId: scopes[index] ?? id,
          objectType: "event" as const,
          displayName: "Policy event",
          createdBy: ownerId,
          deletedAt:
            id === tombstone || id === deletedScope ? evaluatedAt : null,
        })),
      );
      await db.insert(resourceGrants).values(
        [root, deletedScope, expired, boundary, foreign].map((resourceId) => ({
          id: createId(),
          workspaceId: resourceId === foreign ? otherWorkspaceId : workspaceId,
          resourceId,
          principalId: granteeId,
          role,
          grantedBy: ownerId,
          expiresAt:
            resourceId === expired
              ? new Date("2030-01-01T00:00:00Z")
              : resourceId === boundary
                ? evaluatedAt
                : null,
        })),
      );
      const resources = [...ids, createId(), child].map((id) => ({
        id,
        workspaceId,
      }));
      resources.push({ id: child, workspaceId: otherWorkspaceId });
      // The snapshot's fixed clock is also used for exact expiry boundaries.
      await withReadAuthorization(db, async (transaction) => {
        const policy = new AuthorizationService(
          new DrizzleAuthorizationStore(transaction),
          () => evaluatedAt,
        );
        for (const userId of [memberId, granteeId, unrelatedId]) {
          const principal = { type: "user" as const, userId, workspaceId };
          for (const action of authorizationActions) {
            const expected = resources.map((resource) => {
              if (
                resource.workspaceId !== workspaceId ||
                !ids.includes(resource.id) ||
                resource.id === foreign
              )
                return false;
              if (!roleAllows(role, action) || userId === unrelatedId)
                return false;
              if (
                action !== "recover" &&
                [tombstone, deletedScope].includes(resource.id)
              )
                return false;
              if (userId === memberId) return true;
              return action === "recover"
                ? [root, child, tombstone, deletedScope, orphan].includes(
                    resource.id,
                  )
                : [root, child].includes(resource.id);
            });
            expect(await policy.canMany(principal, action, resources)).toEqual(
              expected,
            );
            for (const [index, resource] of resources.entries()) {
              expect(await policy.can(principal, action, resource)).toBe(
                expected[index],
              );
            }
          }
        }
      });
      // Direct grants and membership remain effective when the scope is deleted.
      await db.insert(resourceGrants).values({
        id: createId(),
        workspaceId,
        resourceId: orphan,
        principalId: granteeId,
        role,
        grantedBy: ownerId,
      });
      await withReadAuthorization(db, async (_transaction, policy) => {
        const principal = {
          type: "user" as const,
          userId: granteeId,
          workspaceId,
        };
        expect(
          await policy.canMany(principal, "view", [
            { id: orphan, workspaceId },
          ]),
        ).toEqual([true]);
      });
      await db
        .delete(resourceGrants)
        .where(eq(resourceGrants.principalId, granteeId));
      await withReadAuthorization(db, async (_transaction, policy) => {
        const principal = {
          type: "user" as const,
          userId: granteeId,
          workspaceId,
        };
        expect(await policy.canMany(principal, "view", resources)).toEqual(
          resources.map(() => false),
        );
      });
    },
  );
});
