import { resolve } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runAuditedMutation } from "../src/audited-mutation.js";
import { createId } from "../src/ids.js";
import {
  auditEvents,
  objects,
  users,
  workspaceMembers,
  workspaces,
} from "../src/schema.js";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "../src/testing.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);

let testDatabase: TestDatabase;
let testDatabaseReady = false;
let ownerId: string;
let workspaceId: string;

beforeEach(async () => {
  testDatabaseReady = false;
  testDatabase = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: testDatabase.databaseUrl },
    migrationDirectory,
  );

  ownerId = createId();
  workspaceId = createId();
  await testDatabase.connection.db.insert(users).values({
    id: ownerId,
    identityProvider: "test",
    providerSubject: "audit-owner",
    displayName: "Audit owner",
  });
  await testDatabase.connection.db.insert(workspaces).values({
    id: workspaceId,
    displayName: "Audit workspace",
    createdBy: ownerId,
    personalOwnerId: ownerId,
  });
  await testDatabase.connection.db.insert(workspaceMembers).values({
    workspaceId,
    userId: ownerId,
    role: "owner",
  });
  testDatabaseReady = true;
});

afterEach(async () => {
  if (testDatabaseReady) {
    await testDatabase.close();
  }
  testDatabaseReady = false;
});

describe.sequential("runAuditedMutation", () => {
  it("commits the business change and exactly one audit event", async () => {
    const eventId = createId();
    const requestId = createId();

    await expect(
      runAuditedMutation(testDatabase.connection.db, async (transaction) => {
        await transaction.insert(objects).values({
          id: eventId,
          workspaceId,
          objectType: "event",
          displayName: "Audited event",
          createdBy: ownerId,
          permissionScopeId: eventId,
        });

        return {
          value: eventId,
          audit: {
            workspaceId,
            actorType: "user",
            actorId: ownerId,
            action: "event.created",
            resourceId: eventId,
            requestId,
            metadata: {},
          },
        };
      }),
    ).resolves.toBe(eventId);

    const persistedObjects = await testDatabase.connection.db
      .select({ id: objects.id })
      .from(objects)
      .where(eq(objects.id, eventId));
    const persistedAuditEvents = await testDatabase.connection.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.requestId, requestId));

    expect(persistedObjects).toHaveLength(1);
    expect(persistedAuditEvents).toEqual([{ action: "event.created" }]);
  });

  it("rolls back the business change when the audit event is invalid", async () => {
    const eventId = createId();

    await expect(
      runAuditedMutation(testDatabase.connection.db, async (transaction) => {
        await transaction.insert(objects).values({
          id: eventId,
          workspaceId,
          objectType: "event",
          displayName: "Rolled back event",
          createdBy: ownerId,
          permissionScopeId: eventId,
        });

        return {
          value: eventId,
          audit: {
            workspaceId,
            actorType: "user",
            actorId: ownerId,
            action: "event.created",
            resourceId: createId(),
            requestId: createId(),
            metadata: {},
          },
        };
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });

    const persistedObjects = await testDatabase.connection.db
      .select({ id: objects.id })
      .from(objects)
      .where(eq(objects.id, eventId));
    expect(persistedObjects).toHaveLength(0);
  });
});
