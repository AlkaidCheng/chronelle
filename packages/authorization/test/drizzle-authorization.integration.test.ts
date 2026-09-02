import { resolve } from "node:path";

import {
  createId,
  objectRelations,
  objects,
  resourceGrants,
  users,
  workspaceMembers,
  workspaces,
  type Database,
} from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AuthorizationService } from "../src/authorization.js";
import { DrizzleAuthorizationStore } from "../src/drizzle-authorization-store.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);
const evaluatedAt = new Date("2030-09-02T12:00:00Z");

interface WorkspaceFixture {
  readonly ownerId: string;
  readonly workspaceId: string;
}

let testDatabase: TestDatabase;
let testDatabaseReady = false;

beforeEach(async () => {
  testDatabaseReady = false;
  testDatabase = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: testDatabase.databaseUrl },
    migrationDirectory,
  );
  testDatabaseReady = true;
});

afterEach(async () => {
  if (testDatabaseReady) {
    await testDatabase.close();
  }
  testDatabaseReady = false;
});

async function createUser(database: Database, label: string): Promise<string> {
  const userId = createId();
  await database.insert(users).values({
    id: userId,
    identityProvider: "test",
    providerSubject: `subject-${label}`,
    displayName: `User ${label}`,
  });
  return userId;
}

async function createWorkspace(
  database: Database,
  label: string,
): Promise<WorkspaceFixture> {
  const ownerId = await createUser(database, `${label}-owner`);
  const workspaceId = createId();
  await database.insert(workspaces).values({
    id: workspaceId,
    displayName: `Workspace ${label}`,
    createdBy: ownerId,
    personalOwnerId: ownerId,
  });
  await database.insert(workspaceMembers).values({
    workspaceId,
    userId: ownerId,
    role: "owner",
  });
  return { ownerId, workspaceId };
}

async function createObject(
  database: Database,
  fixture: WorkspaceFixture,
  displayName: string,
  permissionScopeId?: string,
): Promise<string> {
  const objectId = createId();
  await database.insert(objects).values({
    id: objectId,
    workspaceId: fixture.workspaceId,
    objectType: "event",
    displayName,
    createdBy: fixture.ownerId,
    permissionScopeId: permissionScopeId ?? objectId,
  });
  return objectId;
}

describe.sequential("DrizzleAuthorizationStore", () => {
  it("applies membership roles and hides cross-workspace resources", async () => {
    const first = await createWorkspace(
      testDatabase.connection.db,
      "membership-first",
    );
    const second = await createWorkspace(
      testDatabase.connection.db,
      "membership-second",
    );
    const eventId = await createObject(
      testDatabase.connection.db,
      first,
      "Owner event",
    );
    const authorization = new AuthorizationService(
      new DrizzleAuthorizationStore(testDatabase.connection.db),
      () => evaluatedAt,
    );

    await expect(
      authorization.can(
        {
          type: "user",
          userId: first.ownerId,
          workspaceId: first.workspaceId,
        },
        "edit",
        { id: eventId, workspaceId: first.workspaceId },
      ),
    ).resolves.toBe(true);
    await expect(
      authorization.can(
        {
          type: "user",
          userId: first.ownerId,
          workspaceId: second.workspaceId,
        },
        "view",
        { id: eventId, workspaceId: second.workspaceId },
      ),
    ).resolves.toBe(false);
  });

  it("inherits one scope grant while self-scope stops inheritance", async () => {
    const fixture = await createWorkspace(
      testDatabase.connection.db,
      "inheritance",
    );
    const viewerId = await createUser(
      testDatabase.connection.db,
      "inheritance-viewer",
    );
    const eventId = await createObject(
      testDatabase.connection.db,
      fixture,
      "Shared event",
    );
    const inheritingId = await createObject(
      testDatabase.connection.db,
      fixture,
      "Inherited event",
      eventId,
    );
    const privateId = await createObject(
      testDatabase.connection.db,
      fixture,
      "Private event",
    );
    await testDatabase.connection.db.insert(resourceGrants).values({
      id: createId(),
      workspaceId: fixture.workspaceId,
      resourceId: eventId,
      principalId: viewerId,
      role: "viewer",
      grantedBy: fixture.ownerId,
    });
    const authorization = new AuthorizationService(
      new DrizzleAuthorizationStore(testDatabase.connection.db),
      () => evaluatedAt,
    );
    const principal = {
      type: "user" as const,
      userId: viewerId,
      workspaceId: fixture.workspaceId,
    };

    await expect(
      authorization.can(principal, "view", {
        id: inheritingId,
        workspaceId: fixture.workspaceId,
      }),
    ).resolves.toBe(true);
    await expect(
      authorization.can(principal, "edit", {
        id: inheritingId,
        workspaceId: fixture.workspaceId,
      }),
    ).resolves.toBe(false);
    await expect(
      authorization.can(principal, "view", {
        id: privateId,
        workspaceId: fixture.workspaceId,
      }),
    ).resolves.toBe(false);
  });

  it("applies a direct editor grant without granting share access", async () => {
    const fixture = await createWorkspace(
      testDatabase.connection.db,
      "direct-editor",
    );
    const editorId = await createUser(
      testDatabase.connection.db,
      "direct-editor-user",
    );
    const eventId = await createObject(
      testDatabase.connection.db,
      fixture,
      "Edited event",
    );
    await testDatabase.connection.db.insert(resourceGrants).values({
      id: createId(),
      workspaceId: fixture.workspaceId,
      resourceId: eventId,
      principalId: editorId,
      role: "editor",
      grantedBy: fixture.ownerId,
    });
    const authorization = new AuthorizationService(
      new DrizzleAuthorizationStore(testDatabase.connection.db),
      () => evaluatedAt,
    );
    const principal = {
      type: "user" as const,
      userId: editorId,
      workspaceId: fixture.workspaceId,
    };

    await expect(
      authorization.can(principal, "edit", {
        id: eventId,
        workspaceId: fixture.workspaceId,
      }),
    ).resolves.toBe(true);
    await expect(
      authorization.can(principal, "share", {
        id: eventId,
        workspaceId: fixture.workspaceId,
      }),
    ).resolves.toBe(false);
  });

  it("ignores expired grants, deleted resources, and unrelated relations", async () => {
    const fixture = await createWorkspace(
      testDatabase.connection.db,
      "boundaries",
    );
    const viewerId = await createUser(
      testDatabase.connection.db,
      "boundaries-viewer",
    );
    const grantedId = await createObject(
      testDatabase.connection.db,
      fixture,
      "Expired event",
    );
    const relatedId = await createObject(
      testDatabase.connection.db,
      fixture,
      "Related event",
    );
    await testDatabase.connection.db.insert(resourceGrants).values({
      id: createId(),
      workspaceId: fixture.workspaceId,
      resourceId: grantedId,
      principalId: viewerId,
      role: "viewer",
      grantedBy: fixture.ownerId,
      expiresAt: new Date("2029-09-02T12:00:00Z"),
    });
    await testDatabase.connection.db.insert(objectRelations).values({
      id: createId(),
      workspaceId: fixture.workspaceId,
      sourceObjectId: grantedId,
      relationType: "related_to",
      targetObjectId: relatedId,
      createdBy: fixture.ownerId,
    });
    const authorization = new AuthorizationService(
      new DrizzleAuthorizationStore(testDatabase.connection.db),
      () => evaluatedAt,
    );
    const principal = {
      type: "user" as const,
      userId: viewerId,
      workspaceId: fixture.workspaceId,
    };

    await expect(
      authorization.can(principal, "view", {
        id: grantedId,
        workspaceId: fixture.workspaceId,
      }),
    ).resolves.toBe(false);
    await expect(
      authorization.can(principal, "view", {
        id: relatedId,
        workspaceId: fixture.workspaceId,
      }),
    ).resolves.toBe(false);

    await testDatabase.connection.db
      .update(objects)
      .set({ deletedAt: evaluatedAt })
      .where(eq(objects.id, grantedId));
    await expect(
      authorization.can(principal, "view", {
        id: grantedId,
        workspaceId: fixture.workspaceId,
      }),
    ).resolves.toBe(false);
  });
});
