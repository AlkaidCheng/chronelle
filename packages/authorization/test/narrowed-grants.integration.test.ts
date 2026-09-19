import { resolve } from "node:path";

import {
  createId,
  expenses,
  objects,
  resourceGrants,
  sections,
  tasks,
  users,
  workspaceMembers,
  workspaces,
  type Database,
  type ObjectType,
} from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AuthorizationService } from "../src/authorization.js";
import { withReadAuthorization } from "../src/authorization-transaction.js";
import { DrizzleAuthorizationStore } from "../src/drizzle-authorization-store.js";
import { ResourceGrantService } from "../src/grant-service.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);

let testDatabase: TestDatabase;

beforeEach(async () => {
  testDatabase = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: testDatabase.databaseUrl },
    migrationDirectory,
  );
});

afterEach(async () => {
  await testDatabase.close();
});

async function createUser(
  database: Database,
  label: string,
  email: string,
): Promise<string> {
  const userId = createId();
  await database.insert(users).values({
    id: userId,
    identityProvider: "test",
    providerSubject: `subject-${label}`,
    displayName: `User ${label}`,
    email,
  });
  return userId;
}

/**
 * One Event with a task in a section, a loose task, an expense, a
 * reminder, and a note, all inheriting the Event's scope; the owner is a
 * member, the guest holds nothing until a test grants.
 */
async function fixture() {
  const database = testDatabase.connection.db;
  const ownerId = await createUser(database, "owner", "owner@example.test");
  const guestId = await createUser(database, "guest", "guest@example.test");
  const workspaceId = createId();
  await database.insert(workspaces).values({
    id: workspaceId,
    displayName: "Workspace",
    createdBy: ownerId,
    personalOwnerId: ownerId,
  });
  await database
    .insert(workspaceMembers)
    .values({ workspaceId, userId: ownerId, role: "owner" });
  const eventId = createId();
  const object = async (
    objectType: ObjectType,
    displayName: string,
    id = createId(),
  ) => {
    await database.insert(objects).values({
      id,
      workspaceId,
      objectType,
      displayName,
      createdBy: ownerId,
      permissionScopeId:
        objectType === "event" && id === eventId ? id : eventId,
    });
    return id;
  };
  await object("event", "Kyoto", eventId);
  const scheduleId = await object("event", "Lunch");
  const sectionedTaskId = await object("task", "Book the hall");
  const looseTaskId = await object("task", "Order the cake");
  const expenseId = await object("expense", "Venue deposit");
  const reminderId = await object("reminder", "Call the band");
  const noteId = await object("note", "Packing list");
  const sectionId = createId();
  await database.insert(sections).values({
    id: sectionId,
    workspaceId,
    eventId,
    view: "todos",
    name: "Venue",
    rank: "00000001000",
    createdBy: ownerId,
  });
  await database
    .insert(tasks)
    .values({ objectId: sectionedTaskId, workspaceId, sectionId });
  await database.insert(tasks).values({ objectId: looseTaskId, workspaceId });
  await database.insert(expenses).values({
    objectId: expenseId,
    workspaceId,
    amount: "240.0000",
    currency: "USD",
    occurredAt: new Date("2030-11-03T12:00:00Z"),
  });
  const owner = { type: "user" as const, userId: ownerId, workspaceId };
  const guest = { type: "user" as const, userId: guestId, workspaceId };
  const ref = (id: string) => ({ id, workspaceId });
  const grants = new ResourceGrantService(database);
  return {
    database,
    owner,
    guest,
    ref,
    grants,
    eventId,
    scheduleId,
    sectionedTaskId,
    looseTaskId,
    expenseId,
    reminderId,
    noteId,
    sectionId,
  };
}

function evaluator(database: Database) {
  return new AuthorizationService(new DrizzleAuthorizationStore(database));
}

/** What the SQL decisions say, for parity with the store. */
async function sqlDecisions(
  database: Database,
  principal: { userId: string; workspaceId: string },
  objectId: string,
) {
  const [row] = await database.execute<{
    can_view: boolean;
    can_edit: boolean;
    held: string | null;
  }>(sql`
    SELECT chronelle_can_view(${principal.workspaceId}::uuid, ${principal.userId}::uuid, ${objectId}::uuid) AS can_view,
           chronelle_can_edit_live(${principal.workspaceId}::uuid, ${principal.userId}::uuid, ${objectId}::uuid) AS can_edit,
           chronelle_held_role(${principal.workspaceId}::uuid, ${principal.userId}::uuid, ${objectId}::uuid) AS held
  `);
  return row;
}

describe.sequential("grants narrowed to a view or a section", () => {
  it("opens the Event and the shared view's records alone, on both evaluators", async () => {
    const f = await fixture();
    await f.grants.share(
      { principal: f.owner, requestId: createId() },
      {
        resourceId: f.eventId,
        principalEmail: "guest@example.test",
        role: "editor",
        scope: { view: "todos", sectionId: null },
      },
    );
    const authorization = evaluator(f.database);
    const ids = [
      f.eventId,
      f.sectionedTaskId,
      f.looseTaskId,
      f.expenseId,
      f.reminderId,
      f.noteId,
      f.scheduleId,
    ];
    await expect(
      authorization.canMany(f.guest, "view", ids.map(f.ref)),
    ).resolves.toEqual([true, true, true, false, false, false, false]);
    // The Event itself reads as view alone; the tasks carry the role.
    await expect(
      authorization.canMany(f.guest, "edit", ids.map(f.ref)),
    ).resolves.toEqual([false, true, true, false, false, false, false]);
    await expect(
      authorization.narrowing(f.guest, f.ref(f.eventId)),
    ).resolves.toEqual({ views: ["todos"], sections: [] });
    await expect(
      authorization.narrowing(f.owner, f.ref(f.eventId)),
    ).resolves.toBeNull();

    for (const [id, view, edit, held] of [
      [f.eventId, true, false, "viewer"],
      [f.looseTaskId, true, true, "editor"],
      [f.expenseId, false, false, null],
      [f.scheduleId, false, false, null],
    ] as const) {
      expect(await sqlDecisions(f.database, f.guest, id)).toEqual({
        can_view: view,
        can_edit: edit,
        held,
      });
    }
  });

  it("narrows to a section's tasks, and the predicate agrees with canMany", async () => {
    const f = await fixture();
    await f.grants.share(
      { principal: f.owner, requestId: createId() },
      {
        resourceId: f.eventId,
        principalEmail: "guest@example.test",
        role: "viewer",
        scope: { view: "todos", sectionId: f.sectionId },
      },
    );
    const authorization = evaluator(f.database);
    await expect(
      authorization.canMany(
        f.guest,
        "view",
        [f.eventId, f.sectionedTaskId, f.looseTaskId, f.expenseId].map(f.ref),
      ),
    ).resolves.toEqual([true, true, false, false]);
    await expect(
      authorization.narrowing(f.guest, f.ref(f.eventId)),
    ).resolves.toEqual({
      views: [],
      sections: [{ id: f.sectionId, view: "todos" }],
    });
    const visible = await withReadAuthorization(
      f.database,
      async (transaction, bound) =>
        transaction
          .select({ id: objects.id })
          .from(objects)
          .where(
            and(
              eq(objects.workspaceId, f.guest.workspaceId),
              bound.resourcePredicate(f.guest, "view"),
            ),
          ),
    );
    expect(visible.map((row) => row.id).sort()).toEqual(
      [f.eventId, f.sectionedTaskId].sort(),
    );
    // Moving the task out of the section takes it out of the share.
    await f.database
      .update(tasks)
      .set({ sectionId: null })
      .where(eq(tasks.objectId, f.sectionedTaskId));
    await expect(
      authorization.can(f.guest, "view", f.ref(f.sectionedTaskId)),
    ).resolves.toBe(false);
  });

  it("keeps one grant per scope, refreshes a repeated one, and a whole grant sees all", async () => {
    const f = await fixture();
    const context = { principal: f.owner, requestId: createId() };
    const todos = await f.grants.share(context, {
      resourceId: f.eventId,
      principalEmail: "guest@example.test",
      role: "viewer",
      scope: { view: "todos", sectionId: null },
    });
    const expensesGrant = await f.grants.share(context, {
      resourceId: f.eventId,
      principalEmail: "guest@example.test",
      role: "editor",
      scope: { view: "expenses", sectionId: null },
    });
    // The share sheet changes a role by the account's id.
    const raised = await f.grants.share(context, {
      resourceId: f.eventId,
      principalId: f.guest.userId,
      role: "editor",
      scope: { view: "todos", sectionId: null },
    });
    expect(raised.id).toBe(todos.id);
    expect(raised.scope).toEqual({ view: "todos", sectionId: null });
    expect(expensesGrant.scope).toEqual({ view: "expenses", sectionId: null });
    const listed = await f.grants.list(f.owner, f.eventId);
    expect(
      listed.map((grant) => [grant.scope?.view ?? "all", grant.role]),
    ).toEqual([
      ["todos", "editor"],
      ["expenses", "editor"],
    ]);
    const authorization = evaluator(f.database);
    await expect(
      authorization.narrowing(f.guest, f.ref(f.eventId)),
    ).resolves.toEqual({ views: ["expenses", "todos"], sections: [] });
    await expect(
      authorization.canMany(
        f.guest,
        "edit",
        [f.looseTaskId, f.expenseId, f.reminderId].map(f.ref),
      ),
    ).resolves.toEqual([true, true, false]);

    const whole = await f.grants.share(context, {
      resourceId: f.eventId,
      principalEmail: "guest@example.test",
      role: "viewer",
    });
    expect(whole.scope).toBeNull();
    await expect(
      authorization.narrowing(f.guest, f.ref(f.eventId)),
    ).resolves.toBeNull();
    await expect(
      authorization.can(f.guest, "view", f.ref(f.reminderId)),
    ).resolves.toBe(true);
  });

  it("refuses a narrowed share that is not of an Event or names a foreign section", async () => {
    const f = await fixture();
    const context = { principal: f.owner, requestId: createId() };
    await expect(
      f.grants.share(context, {
        resourceId: f.looseTaskId,
        principalEmail: "guest@example.test",
        role: "viewer",
        scope: { view: "todos", sectionId: null },
      }),
    ).rejects.toThrow("A share narrowed to a view names an Event.");
    await expect(
      f.grants.share(context, {
        resourceId: f.eventId,
        principalEmail: "guest@example.test",
        role: "viewer",
        scope: { view: "expenses", sectionId: f.sectionId },
      }),
    ).rejects.toThrow(
      "The section is not a section of that view of the Event.",
    );
    // The same rule holds at the table, whatever writes the row.
    await expect(
      f.database.insert(resourceGrants).values({
        id: createId(),
        workspaceId: f.guest.workspaceId,
        resourceId: f.looseTaskId,
        principalId: f.guest.userId,
        role: "viewer",
        grantedBy: f.owner.userId,
        scope: "todos",
      }),
    ).rejects.toThrow(/Failed query/);
  });

  it("ends a section's shares with the section and keeps recovery to whole owner grants", async () => {
    const f = await fixture();
    const context = { principal: f.owner, requestId: createId() };
    await f.grants.share(context, {
      resourceId: f.eventId,
      principalEmail: "guest@example.test",
      role: "owner",
      scope: { view: "todos", sectionId: f.sectionId },
    });
    const authorization = evaluator(f.database);
    // An owner grant narrowed to a section recovers the section's task,
    // not the Event.
    await expect(
      authorization.canMany(
        f.guest,
        "recover",
        [f.eventId, f.sectionedTaskId, f.looseTaskId].map(f.ref),
      ),
    ).resolves.toEqual([false, true, false]);
    await f.database.delete(sections).where(eq(sections.id, f.sectionId));
    await expect(f.grants.list(f.owner, f.eventId)).resolves.toEqual([]);
    await expect(
      authorization.can(f.guest, "view", f.ref(f.eventId)),
    ).resolves.toBe(false);
  });
});
