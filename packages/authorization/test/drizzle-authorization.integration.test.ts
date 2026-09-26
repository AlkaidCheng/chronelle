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
} from "@livtales/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthorizationDeniedError,
  AuthorizationService,
} from "../src/authorization.js";
import { DrizzleAuthorizationStore } from "../src/drizzle-authorization-store.js";
import {
  withReadAuthorization,
  withStableAuthorization,
  withStableAuthorizationAcross,
} from "../src/authorization-transaction.js";

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
  vi.useRealTimers();
  vi.restoreAllMocks();
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
  it("uses one read-only snapshot and releases it on failure", async () => {
    const fixture = await createWorkspace(
      testDatabase.connection.db,
      "snapshot",
    );
    const objectId = await createObject(
      testDatabase.connection.db,
      fixture,
      "Shared name",
    );
    await withReadAuthorization(
      testDatabase.connection.db,
      async (transaction, authorization) => {
        const settings = await transaction.execute(
          sql`SELECT current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only`,
        );
        expect(settings[0]).toMatchObject({
          isolation: "repeatable read",
          read_only: "on",
        });
        await testDatabase.connection.db
          .update(objects)
          .set({ displayName: "Later name" })
          .where(eq(objects.id, objectId));
        const [row] = await transaction
          .select()
          .from(objects)
          .where(eq(objects.id, objectId));
        expect(row?.displayName).toBe("Shared name");
        await withReadAuthorization(
          { database: transaction, authorization },
          async (nested, policy) => {
            expect(nested).toBe(transaction);
            expect(policy).toBe(authorization);
          },
        );
      },
    );
    await expect(
      withReadAuthorization(testDatabase.connection.db, (transaction) =>
        transaction
          .update(objects)
          .set({ displayName: "Forbidden write" })
          .where(eq(objects.id, objectId))
          .execute(),
      ),
    ).rejects.toMatchObject({ cause: { code: "25006" } });
    const [row] = await testDatabase.connection.db
      .select()
      .from(objects)
      .where(eq(objects.id, objectId));
    expect(row?.displayName).toBe("Later name");
    await expect(
      withReadAuthorization(testDatabase.connection.db, async () => {
        throw new Error("Read failed");
      }),
    ).rejects.toThrow("Read failed");
    await expect(
      withReadAuthorization(
        testDatabase.connection.db,
        async () => "available",
      ),
    ).resolves.toBe("available");
  });

  it("rejects bare nested transactions and composes with a protected writer", async () => {
    const fixture = await createWorkspace(testDatabase.connection.db, "nested");
    await testDatabase.connection.db.transaction(async (transaction) => {
      await expect(
        withReadAuthorization(transaction, async () => undefined),
      ).rejects.toThrow("explicit transaction context");
    });
    await withStableAuthorization(
      testDatabase.connection.db,
      fixture.workspaceId,
      async (transaction, authorization) => {
        await withReadAuthorization(
          { database: transaction, authorization },
          async (nested) => {
            const settings = await nested.execute(
              sql`SELECT current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only`,
            );
            expect(settings[0]).toMatchObject({
              isolation: "read committed",
              read_only: "off",
            });
          },
        );
      },
    );
  });

  it("fences several workspaces in ascending id order", async () => {
    const db = testDatabase.connection.db;
    const client = testDatabase.connection.sql;
    const [low, high] = [
      (await createWorkspace(db, "fence-first")).workspaceId,
      (await createWorkspace(db, "fence-second")).workspaceId,
    ].sort();
    if (low === undefined || high === undefined) throw new Error("no fences");
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = () => {};
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    const holder = client.begin(async (transaction) => {
      await transaction`SELECT id FROM workspaces WHERE id = ${high} FOR NO KEY UPDATE`;
      held();
      await released;
    });
    await holding;
    const fenced = withStableAuthorizationAcross(
      db,
      [high.toUpperCase(), low, high],
      async () => "written",
    );
    // The lower fence is taken while the higher one is still awaited.
    const lowerFence = async () => {
      try {
        await client.begin(
          (transaction) =>
            transaction`SELECT id FROM workspaces WHERE id = ${low} FOR NO KEY UPDATE NOWAIT`,
        );
        return "free";
      } catch (error) {
        return (error as { code?: string }).code;
      }
    };
    await expect.poll(lowerFence).toBe("55P03");
    release();
    await holder;
    await expect(fenced).resolves.toBe("written");
    expect(await lowerFence()).toBe("free");
    await expect(
      withStableAuthorizationAcross(db, [low, createId()], async () => "never"),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("evaluates expiration at one instant per snapshot without caching later requests", async () => {
    const fixture = await createWorkspace(
      testDatabase.connection.db,
      "expiration",
    );
    const viewerId = await createUser(
      testDatabase.connection.db,
      "expiration-viewer",
    );
    const objectId = await createObject(
      testDatabase.connection.db,
      fixture,
      "Expiring event",
    );
    await testDatabase.connection.db.insert(resourceGrants).values({
      id: createId(),
      workspaceId: fixture.workspaceId,
      resourceId: objectId,
      principalId: viewerId,
      role: "viewer",
      grantedBy: fixture.ownerId,
      expiresAt: new Date("2030-09-02T12:00:01Z"),
    });
    const principal = {
      type: "user" as const,
      userId: viewerId,
      workspaceId: fixture.workspaceId,
    };
    const resource = { id: objectId, workspaceId: fixture.workspaceId };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(evaluatedAt);
    await withReadAuthorization(
      testDatabase.connection.db,
      async (_transaction, authorization) => {
        expect(await authorization.can(principal, "view", resource)).toBe(true);
        vi.setSystemTime(new Date("2030-09-02T12:00:02Z"));
        expect(await authorization.can(principal, "view", resource)).toBe(true);
      },
    );
    await withReadAuthorization(
      testDatabase.connection.db,
      async (_transaction, authorization) => {
        expect(await authorization.can(principal, "view", resource)).toBe(
          false,
        );
      },
    );
  });

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

  it("lists a member's own objects apart from the ones shared from other workspaces", async () => {
    const db = testDatabase.connection.db;
    const home = await createWorkspace(db, "list-home");
    const other = await createWorkspace(db, "list-other");
    const joined = await createWorkspace(db, "list-joined");
    const ownEvent = await createObject(db, home, "Own event");
    const sharedEvent = await createObject(db, other, "Shared event");
    const expiredEvent = await createObject(db, other, "Expired share");
    const memberEvent = await createObject(db, joined, "Member event");
    await createObject(db, other, "Not shared");
    await db.insert(workspaceMembers).values({
      workspaceId: joined.workspaceId,
      userId: home.ownerId,
      role: "editor",
    });
    await db.insert(resourceGrants).values([
      {
        id: createId(),
        workspaceId: other.workspaceId,
        resourceId: sharedEvent,
        principalId: home.ownerId,
        role: "viewer",
        grantedBy: other.ownerId,
      },
      {
        id: createId(),
        workspaceId: other.workspaceId,
        resourceId: expiredEvent,
        principalId: home.ownerId,
        role: "viewer",
        grantedBy: other.ownerId,
        expiresAt: new Date(evaluatedAt.getTime() - 1),
      },
      {
        id: createId(),
        workspaceId: joined.workspaceId,
        resourceId: memberEvent,
        principalId: home.ownerId,
        role: "viewer",
        grantedBy: joined.ownerId,
      },
    ]);
    const authorization = new AuthorizationService(
      new DrizzleAuthorizationStore(db),
      () => evaluatedAt,
    );
    const principal = {
      type: "user" as const,
      userId: home.ownerId,
      workspaceId: home.workspaceId,
    };
    const names = async (predicate: ReturnType<typeof sql>) =>
      (
        await db
          .select({ name: objects.displayName })
          .from(objects)
          .where(predicate)
          .orderBy(objects.displayName)
      ).map((row) => row.name);
    await expect(
      names(authorization.memberResourcePredicate(principal)),
    ).resolves.toEqual(["Own event"]);
    // A grant in a workspace the account belongs to is not a share to list.
    await expect(
      names(authorization.sharedResourcePredicate(principal)),
    ).resolves.toEqual(["Shared event"]);
    await expect(
      names(
        authorization.memberResourcePredicate({
          ...principal,
          workspaceId: other.workspaceId,
        }),
      ),
    ).resolves.toEqual([]);
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

    await expect(
      authorization.listAccessibleWorkspaceIds(viewerId),
    ).resolves.toEqual([fixture.workspaceId]);
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
