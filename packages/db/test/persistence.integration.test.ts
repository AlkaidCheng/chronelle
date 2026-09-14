import { appendFile, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createId } from "../src/ids.js";
import { applyMigrations } from "../src/migrations.js";
import {
  auditEvents,
  events,
  objectRelations,
  objects,
  resourceGrants,
  tasks,
  users,
  workspaceMembers,
  workspaces,
  type ObjectType,
} from "../src/schema.js";
import { createTestDatabase, type TestDatabase } from "../src/testing.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);
const temporaryDirectories: string[] = [];

let testDatabase: TestDatabase;
let testDatabaseReady = false;

beforeEach(async () => {
  testDatabaseReady = false;
  testDatabase = await createTestDatabase();
  testDatabaseReady = true;
});

afterEach(async () => {
  try {
    if (testDatabaseReady) {
      await testDatabase.close();
    }
  } finally {
    testDatabaseReady = false;
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    );
  }
});

interface WorkspaceFixture {
  readonly userId: string;
  readonly workspaceId: string;
}

async function createWorkspaceFixture(
  label: string,
): Promise<WorkspaceFixture> {
  const userId = createId();
  const workspaceId = createId();
  const { db } = testDatabase.connection;

  await db.insert(users).values({
    id: userId,
    identityProvider: "test",
    providerSubject: `subject-${label}`,
    displayName: `User ${label}`,
  });
  await db.insert(workspaces).values({
    id: workspaceId,
    displayName: `Workspace ${label}`,
    createdBy: userId,
  });
  await db.insert(workspaceMembers).values({
    workspaceId,
    userId,
    role: "owner",
  });

  return { userId, workspaceId };
}

async function createCanonicalObject(
  fixture: WorkspaceFixture,
  objectType: ObjectType,
  displayName: string,
): Promise<string> {
  const objectId = createId();

  await testDatabase.connection.db.insert(objects).values({
    id: objectId,
    workspaceId: fixture.workspaceId,
    objectType,
    displayName,
    createdBy: fixture.userId,
    permissionScopeId: objectId,
  });

  return objectId;
}

async function expectPostgresError(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(operation).rejects.toMatchObject({ cause: { code } });
}

describe.sequential("persistence kernel", () => {
  it("applies the full schema once and exposes typed queries", async () => {
    await expect(
      applyMigrations(
        { DATABASE_URL: testDatabase.databaseUrl },
        migrationDirectory,
      ),
    ).resolves.toBe(27);
    await expect(
      applyMigrations(
        { DATABASE_URL: testDatabase.databaseUrl },
        migrationDirectory,
      ),
    ).resolves.toBe(0);

    const installedTables = await testDatabase.connection.sql<
      { tablename: string }[]
    >`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;
    expect(installedTables.map(({ tablename }) => tablename)).toEqual([
      "audit_events",
      "chronelle_schema_migrations",
      "command_changes",
      "command_receipts",
      "command_stacks",
      "document_transfer_authorizations",
      "documents",
      "event_context_commands",
      "event_page_revisions",
      "events",
      "expenses",
      "object_relations",
      "object_revisions",
      "objects",
      "reminders",
      "resource_grants",
      "reversible_commands",
      "tasks",
      "users",
      "workspace_members",
      "workspaces",
    ]);

    const fixture = await createWorkspaceFixture("fresh");
    const eventId = await createCanonicalObject(
      fixture,
      "event",
      "Launch dinner",
    );
    await testDatabase.connection.db.insert(events).values({
      objectId: eventId,
      workspaceId: fixture.workspaceId,
      startsAt: new Date("2026-10-15T18:00:00Z"),
      timezone: "America/Los_Angeles",
    });

    const persistedEvents = await testDatabase.connection.db
      .select()
      .from(events)
      .where(eq(events.objectId, eventId));
    const canonicalEvents = await testDatabase.connection.db
      .select()
      .from(objects)
      .where(eq(objects.id, eventId));

    expect(persistedEvents).toHaveLength(1);
    expect(persistedEvents[0]?.objectType).toBe("event");
    expect(canonicalEvents).toHaveLength(1);
    expect(canonicalEvents[0]).toMatchObject({
      customProperties: {},
      deletedAt: null,
      metadata: {},
      objectType: "event",
      permissionScopeId: eventId,
      version: 1,
    });
  });

  it("rejects a changed migration after it has been applied", async () => {
    const copiedMigrationDirectory = await mkdtemp(
      join(tmpdir(), "chronelle-integration-migrations-"),
    );
    temporaryDirectories.push(copiedMigrationDirectory);
    await cp(migrationDirectory, copiedMigrationDirectory, { recursive: true });

    await applyMigrations(
      { DATABASE_URL: testDatabase.databaseUrl },
      copiedMigrationDirectory,
    );
    await appendFile(
      join(copiedMigrationDirectory, "0001_create_persistence_kernel.sql"),
      "\n-- checksum change\n",
    );

    await expect(
      applyMigrations(
        { DATABASE_URL: testDatabase.databaseUrl },
        copiedMigrationDirectory,
      ),
    ).rejects.toThrow(
      "Applied migration 0001_create_persistence_kernel.sql has been modified.",
    );
  });

  it("requires each typed row to match one canonical object", async () => {
    await applyMigrations(
      { DATABASE_URL: testDatabase.databaseUrl },
      migrationDirectory,
    );
    const fixture = await createWorkspaceFixture("typed");

    await expectPostgresError(
      testDatabase.connection.db.insert(events).values({
        objectId: createId(),
        workspaceId: fixture.workspaceId,
      }),
      "23503",
    );

    const taskId = await createCanonicalObject(fixture, "task", "Send invites");
    await testDatabase.connection.db.insert(tasks).values({
      objectId: taskId,
      workspaceId: fixture.workspaceId,
    });
    await expectPostgresError(
      testDatabase.connection.db.insert(events).values({
        objectId: taskId,
        workspaceId: fixture.workspaceId,
      }),
      "23503",
    );
  });

  it("enforces one correctly owned personal workspace per user", async () => {
    await applyMigrations(
      { DATABASE_URL: testDatabase.databaseUrl },
      migrationDirectory,
    );
    const first = await createWorkspaceFixture("personal-first");
    const second = await createWorkspaceFixture("personal-second");

    await expectPostgresError(
      testDatabase.connection.db.insert(workspaces).values({
        id: createId(),
        displayName: "Mismatched personal workspace",
        createdBy: first.userId,
        personalOwnerId: second.userId,
      }),
      "23514",
    );

    await testDatabase.connection.db.insert(workspaces).values({
      id: createId(),
      displayName: "Personal workspace",
      createdBy: first.userId,
      personalOwnerId: first.userId,
    });
    await expectPostgresError(
      testDatabase.connection.db.insert(workspaces).values({
        id: createId(),
        displayName: "Duplicate personal workspace",
        createdBy: first.userId,
        personalOwnerId: first.userId,
      }),
      "23505",
    );
  });

  it("isolates relation and grant resources by workspace", async () => {
    await applyMigrations(
      { DATABASE_URL: testDatabase.databaseUrl },
      migrationDirectory,
    );
    const firstWorkspace = await createWorkspaceFixture("first");
    const secondWorkspace = await createWorkspaceFixture("second");
    const firstEventId = await createCanonicalObject(
      firstWorkspace,
      "event",
      "First event",
    );
    const secondEventId = await createCanonicalObject(
      secondWorkspace,
      "event",
      "Second event",
    );

    await expectPostgresError(
      testDatabase.connection.db.insert(objects).values({
        id: createId(),
        workspaceId: firstWorkspace.workspaceId,
        objectType: "event",
        displayName: "Invalid inherited event",
        createdBy: firstWorkspace.userId,
        permissionScopeId: secondEventId,
      }),
      "23503",
    );

    await expectPostgresError(
      testDatabase.connection.db.insert(objectRelations).values({
        id: createId(),
        workspaceId: firstWorkspace.workspaceId,
        sourceObjectId: firstEventId,
        relationType: "related_to",
        targetObjectId: secondEventId,
        createdBy: firstWorkspace.userId,
      }),
      "23503",
    );
    await expectPostgresError(
      testDatabase.connection.db.insert(resourceGrants).values({
        id: createId(),
        workspaceId: secondWorkspace.workspaceId,
        resourceId: firstEventId,
        principalId: secondWorkspace.userId,
        role: "viewer",
        grantedBy: firstWorkspace.userId,
      }),
      "23503",
    );
    await expect(
      testDatabase.connection.db.insert(resourceGrants).values({
        id: createId(),
        workspaceId: firstWorkspace.workspaceId,
        resourceId: firstEventId,
        principalId: secondWorkspace.userId,
        role: "viewer",
        grantedBy: firstWorkspace.userId,
      }),
    ).resolves.toBeDefined();
  });

  it("keeps canonical objects after unlink and makes audit events immutable", async () => {
    await applyMigrations(
      { DATABASE_URL: testDatabase.databaseUrl },
      migrationDirectory,
    );
    const fixture = await createWorkspaceFixture("lifecycle");
    const eventId = await createCanonicalObject(fixture, "event", "Conference");
    const taskId = await createCanonicalObject(fixture, "task", "Book venue");
    const relationId = createId();

    await testDatabase.connection.db.insert(objectRelations).values({
      id: relationId,
      workspaceId: fixture.workspaceId,
      sourceObjectId: eventId,
      relationType: "includes",
      targetObjectId: taskId,
      createdBy: fixture.userId,
    });
    await expectPostgresError(
      testDatabase.connection.db.insert(objectRelations).values({
        id: createId(),
        workspaceId: fixture.workspaceId,
        sourceObjectId: eventId,
        relationType: "includes",
        targetObjectId: taskId,
        createdBy: fixture.userId,
      }),
      "23505",
    );
    await testDatabase.connection.db
      .update(objectRelations)
      .set({ deletedAt: new Date(), version: 2 })
      .where(eq(objectRelations.id, relationId));
    const replacementRelationId = createId();
    await testDatabase.connection.db.insert(objectRelations).values({
      id: replacementRelationId,
      workspaceId: fixture.workspaceId,
      sourceObjectId: eventId,
      relationType: "includes",
      targetObjectId: taskId,
      createdBy: fixture.userId,
    });
    await testDatabase.connection.db
      .delete(objectRelations)
      .where(eq(objectRelations.id, replacementRelationId));

    const remainingObjects = await testDatabase.connection.db
      .select({ id: objects.id })
      .from(objects);
    expect(remainingObjects).toHaveLength(2);

    const auditEventId = createId();
    await testDatabase.connection.db.insert(auditEvents).values({
      id: auditEventId,
      workspaceId: fixture.workspaceId,
      actorType: "user",
      actorId: fixture.userId,
      action: "relation.removed",
      resourceId: eventId,
      requestId: createId(),
    });

    await expectPostgresError(
      testDatabase.connection.db
        .update(auditEvents)
        .set({ action: "relation.changed" })
        .where(eq(auditEvents.id, auditEventId)),
      "55000",
    );
    await expectPostgresError(
      testDatabase.connection.db
        .delete(auditEvents)
        .where(eq(auditEvents.id, auditEventId)),
      "55000",
    );
  });
});
