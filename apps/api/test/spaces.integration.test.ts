import { resolve } from "node:path";

import {
  auditEvents,
  createId,
  disconnectedDatabase,
  objectRevisions,
  objects,
  pendingShares,
  resourceGrants,
  workspaceMembers,
  workspaces,
} from "@livtales/db";
import {
  applyMigrations,
  createCloudBaseLiveReader,
  createCloudBaseRpcDouble,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import {
  accessibleWorkspaceSchema,
  developmentSignInResponseSchema,
  eventResponseSchema,
  objectMoveTargetsResponseSchema,
  personResponseSchema,
  sentInvitationSchema,
  sessionResponseSchema,
  taskResponseSchema,
  workspaceDeletionResponseSchema,
  workspaceMemberListResponseSchema,
  workspaceMemberSchema,
} from "@livtales/schemas";
import { asc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { createDevelopmentAppDependencies } from "../src/dependencies.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);

// Spaces and their members go through the HTTP contract, so they are run
// on both backends: the PostgreSQL app, and the app composed for the
// gateway with the rpc functions called locally and no database connection.
const transportWrite = () =>
  Promise.reject(new Error("Spaces write through the rpc functions."));
const backends = {
  postgres: (database: TestDatabase) =>
    createDevelopmentAppDependencies(database.connection),
  cloudbase: (database: TestDatabase) =>
    createDevelopmentAppDependencies(disconnectedDatabase("the spaces test"), {
      cloudBaseRdb: {
        ...createCloudBaseLiveReader(database.connection.db),
        rpc: createCloudBaseRpcDouble(database.connection.sql),
        insert: transportWrite,
        update: transportWrite,
        delete: transportWrite,
      },
      cloudBaseWrites: true,
    }),
};

let testDatabase: TestDatabase;
let app: FastifyInstance;

beforeEach(async () => {
  testDatabase = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: testDatabase.databaseUrl },
    migrationDirectory,
  );
});

afterEach(async () => {
  await app?.close();
  await testDatabase.close();
});

type Session = ReturnType<typeof developmentSignInResponseSchema.parse>;

async function signIn(email: string, displayName: string): Promise<Session> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/development/sign-in",
    payload: { email, displayName },
  });
  expect(response.statusCode).toBe(200);
  return developmentSignInResponseSchema.parse(response.json());
}

function request(
  session: Session,
  options: Omit<InjectOptions, "headers">,
  workspaceId = session.workspace.id,
) {
  return app.inject({
    ...options,
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-workspace-id": workspaceId,
    },
  });
}

/** Two accounts become friends: one invites the other's email, which accepts. */
async function befriend(requester: Session, addressee: Session, email: string) {
  const sent = await request(requester, {
    method: "POST",
    url: "/api/friends/invitations",
    payload: { email },
  });
  expect(sent.statusCode).toBe(201);
  const item = sentInvitationSchema.parse(sent.json());
  const accepted = await request(addressee, {
    method: "POST",
    url: `/api/friends/requests/${item.id}/accept`,
  });
  expect(accepted.statusCode).toBe(200);
  return item.id;
}

async function createSpace(session: Session, displayName: string) {
  const response = await request(session, {
    method: "POST",
    url: "/api/workspaces",
    payload: { displayName },
  });
  expect(response.statusCode).toBe(201);
  return accessibleWorkspaceSchema.parse(response.json());
}

async function spacesOf(session: Session) {
  const response = await request(session, {
    method: "GET",
    url: "/api/auth/session",
  });
  expect(response.statusCode).toBe(200);
  return sessionResponseSchema.parse(response.json()).availableWorkspaces;
}

async function membersOf(session: Session, workspaceId: string) {
  const response = await request(
    session,
    { method: "GET", url: "/api/workspaces/current/members" },
    workspaceId,
  );
  expect(response.statusCode).toBe(200);
  return workspaceMemberListResponseSchema
    .parse(response.json())
    .items.map(({ displayName, role }) => ({ displayName, role }));
}

function changeRole(
  session: Session,
  workspaceId: string,
  memberId: string,
  role: string,
) {
  return request(
    session,
    {
      method: "PATCH",
      url: `/api/workspaces/current/members/${memberId}`,
      payload: { role },
    },
    workspaceId,
  );
}

function leave(session: Session, workspaceId: string) {
  return request(
    session,
    { method: "POST", url: "/api/workspaces/current/leave" },
    workspaceId,
  );
}

function deletionOf(session: Session, workspaceId: string) {
  return request(
    session,
    { method: "GET", url: "/api/workspaces/current/deletion" },
    workspaceId,
  );
}

async function deletable(session: Session, workspaceId: string) {
  const response = await deletionOf(session, workspaceId);
  expect(response.statusCode).toBe(200);
  return workspaceDeletionResponseSchema.parse(response.json());
}

function deleteSpace(session: Session, workspaceId: string) {
  return request(
    session,
    { method: "DELETE", url: "/api/workspaces/current" },
    workspaceId,
  );
}

async function create<T>(
  session: Session,
  workspaceId: string,
  url: string,
  payload: Record<string, unknown>,
  schema: { parse(value: unknown): T },
): Promise<T> {
  const response = await request(
    session,
    { method: "POST", url, payload },
    workspaceId,
  );
  expect(response.statusCode).toBe(201);
  return schema.parse(response.json());
}

/** Moves a record at version 1 to Trash. */
async function trash(session: Session, workspaceId: string, id: string) {
  const response = await request(
    session,
    { method: "DELETE", url: `/api/objects/${id}?expectedVersion=1` },
    workspaceId,
  );
  expect(response.statusCode).toBe(200);
}

/** The workspace's own audit trail: its membership and naming events, oldest first. */
async function spaceActionsIn(workspaceId: string) {
  const rows = await testDatabase.connection.db
    .select({ action: auditEvents.action })
    .from(auditEvents)
    .where(eq(auditEvents.workspaceId, workspaceId))
    .orderBy(asc(auditEvents.id));
  return rows
    .map((row) => row.action)
    .filter((action) => action.startsWith("workspace."));
}

describe.each(Object.entries(backends))("Spaces (%s)", (_backend, compose) => {
  beforeEach(() => {
    app = buildApp(compose(testDatabase));
  });

  it("creates a space with its creator as Owner and lets an Owner rename it", async () => {
    const ana = await signIn("ana@example.test", "Ana");
    const ben = await signIn("ben@example.test", "Ben");

    const space = await createSpace(ana, "  Our wedding ");
    expect(space).toMatchObject({
      displayName: "Our wedding",
      personal: false,
      ownerDisplayName: "Ana",
      role: "owner",
    });
    expect(await spacesOf(ana)).toContainEqual(space);
    expect(await membersOf(ana, space.id)).toEqual([
      { displayName: "Ana", role: "owner" },
    ]);
    // Work created in it lives there.
    const created = await request(
      ana,
      { method: "POST", url: "/api/events", payload: { displayName: "Vows" } },
      space.id,
    );
    expect(created.statusCode).toBe(201);
    expect(eventResponseSchema.parse(created.json()).workspaceId).toBe(
      space.id,
    );

    const renamed = await request(
      ana,
      {
        method: "PATCH",
        url: "/api/workspaces/current",
        payload: { displayName: "Kyoto 2027" },
      },
      space.id,
    );
    expect(renamed.statusCode).toBe(200);
    expect(accessibleWorkspaceSchema.parse(renamed.json())).toEqual({
      ...space,
      displayName: "Kyoto 2027",
    });
    // A blank name, a Personal space, and a stranger are refused.
    const blank = await request(
      ana,
      {
        method: "PATCH",
        url: "/api/workspaces/current",
        payload: { displayName: "   " },
      },
      space.id,
    );
    expect(blank.statusCode).toBe(400);
    const personal = await request(ana, {
      method: "PATCH",
      url: "/api/workspaces/current",
      payload: { displayName: "Mine" },
    });
    expect(personal.statusCode).toBe(400);
    expect(personal.json().error.message).toBe(
      "A Personal space keeps its name.",
    );
    const stranger = await request(
      ben,
      {
        method: "PATCH",
        url: "/api/workspaces/current",
        payload: { displayName: "Taken" },
      },
      space.id,
    );
    expect(stranger.statusCode).toBe(404);
    expect(await spaceActionsIn(space.id)).toEqual([
      "workspace.created",
      "workspace.renamed",
    ]);
  });

  it("shares ownership among members and keeps at least one Owner", async () => {
    const ana = await signIn("ana@example.test", "Ana");
    const ben = await signIn("ben@example.test", "Ben");
    const friendId = await befriend(ana, ben, "ben@example.test");
    const space = await createSpace(ana, "Our wedding");

    const added = await request(
      ana,
      {
        method: "POST",
        url: "/api/workspaces/current/members",
        payload: { friendId, role: "owner" },
      },
      space.id,
    );
    expect(added.statusCode).toBe(201);
    expect(workspaceMemberSchema.parse(added.json()).role).toBe("owner");
    expect(await spacesOf(ben)).toContainEqual({
      ...space,
      role: "owner",
    });

    // Ben, an Owner, changes Ana's role, and is then the last Owner: he
    // can neither step down nor leave.
    const demoted = await changeRole(ben, space.id, ana.user.id, "editor");
    expect(demoted.statusCode).toBe(200);
    expect(workspaceMemberSchema.parse(demoted.json()).role).toBe("editor");
    const selfDemoted = await changeRole(ben, space.id, ben.user.id, "viewer");
    expect(selfDemoted.statusCode).toBe(409);
    expect(selfDemoted.json().error.message).toBe(
      "A space keeps at least one Owner.",
    );
    expect((await leave(ben, space.id)).statusCode).toBe(409);
    // An Editor changes no roles.
    expect(
      (await changeRole(ana, space.id, ben.user.id, "viewer")).statusCode,
    ).toBe(404);

    // With Ana an Owner again, Ben leaves, and the space leaves his list.
    expect(
      (await changeRole(ben, space.id, ana.user.id, "owner")).statusCode,
    ).toBe(200);
    const left = await leave(ben, space.id);
    expect(left.statusCode).toBe(200);
    expect(left.json()).toEqual({ userId: ben.user.id, left: true });
    expect(
      (await spacesOf(ben)).map((workspace) => workspace.id),
    ).not.toContain(space.id);
    expect(await membersOf(ana, space.id)).toEqual([
      { displayName: "Ana", role: "owner" },
    ]);
    expect(await spaceActionsIn(space.id)).toEqual([
      "workspace.created",
      "workspace.member_added",
      "workspace.member_role_changed",
      "workspace.member_role_changed",
      "workspace.member_left",
    ]);
  });

  it("keeps a Personal space's account as its one Owner", async () => {
    const ana = await signIn("ana@example.test", "Ana");
    const ben = await signIn("ben@example.test", "Ben");
    const friendId = await befriend(ana, ben, "ben@example.test");
    const personal = ana.workspace.id;

    const asOwner = await request(ana, {
      method: "POST",
      url: "/api/workspaces/current/members",
      payload: { friendId, role: "owner" },
    });
    expect(asOwner.statusCode).toBe(400);
    expect(asOwner.json().error.message).toBe(
      "A Personal space has one Owner.",
    );
    // Members still join a Personal space as Editors or Viewers.
    expect(
      (
        await request(ana, {
          method: "POST",
          url: "/api/workspaces/current/members",
          payload: { friendId, role: "editor" },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await changeRole(ana, personal, ben.user.id, "owner")).statusCode,
    ).toBe(400);
    const own = await changeRole(ana, personal, ana.user.id, "editor");
    expect(own.statusCode).toBe(400);
    expect(own.json().error.message).toBe(
      "The Owner of a Personal space keeps the role.",
    );
    const staying = await leave(ana, personal);
    expect(staying.statusCode).toBe(400);
    expect(staying.json().error.message).toBe(
      "The Owner of a Personal space cannot leave it.",
    );
    // A member leaves it like any other space.
    expect((await leave(ben, personal)).statusCode).toBe(200);
    expect(await membersOf(ana, personal)).toEqual([
      { displayName: "Ana", role: "owner" },
    ]);
  });

  it("changes a space's members one change at a time", async () => {
    const ana = await signIn("ana@example.test", "Ana");
    const ben = await signIn("ben@example.test", "Ben");
    const friendId = await befriend(ana, ben, "ben@example.test");
    const space = await createSpace(ana, "Our wedding");
    expect(
      (
        await request(
          ana,
          {
            method: "POST",
            url: "/api/workspaces/current/members",
            payload: { friendId, role: "owner" },
          },
          space.id,
        )
      ).statusCode,
    ).toBe(201);

    // While another transaction holds the space's lock, a role change
    // waits for it: two Owners demoting each other cannot both read the
    // other as the remaining Owner.
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const holder = testDatabase.connection.sql.begin(async (sql) => {
      await sql`SELECT 1 FROM workspaces WHERE id = ${space.id} FOR NO KEY UPDATE`;
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    let settled = false;
    const change = changeRole(ben, space.id, ana.user.id, "editor").then(
      (response) => {
        settled = true;
        return response;
      },
    );
    await new Promise((wait) => setTimeout(wait, 300));
    expect(settled).toBe(false);
    release.resolve();
    await holder;
    expect((await change).statusCode).toBe(200);
    expect(
      (await membersOf(ana, space.id)).filter(
        (member) => member.role === "owner",
      ),
    ).toEqual([{ displayName: "Ben", role: "owner" }]);
  });

  it("shares a single record as Editor or Viewer, never Owner", async () => {
    const ana = await signIn("ana@example.test", "Ana");
    await signIn("ben@example.test", "Ben");
    const created = await request(ana, {
      method: "POST",
      url: "/api/events",
      payload: { displayName: "Kyoto" },
    });
    const event = eventResponseSchema.parse(created.json());
    const share = (role: string) =>
      request(ana, {
        method: "POST",
        url: "/api/shares",
        payload: {
          resourceId: event.id,
          principalEmail: "ben@example.test",
          role,
        },
      });
    expect((await share("owner")).statusCode).toBe(400);
    expect((await share("editor")).statusCode).toBe(201);
  });

  it("deletes a space that holds nothing but Trash, keeping its records and history", async () => {
    const ana = await signIn("ana@example.test", "Ana");
    const ben = await signIn("ben@example.test", "Ben");
    const cy = await signIn("cy@example.test", "Cy");
    const benFriend = await befriend(ana, ben, "ben@example.test");
    const cyFriend = await befriend(ana, cy, "cy@example.test");
    const space = await createSpace(ana, "Our wedding");
    expect(
      (
        await request(
          ana,
          {
            method: "POST",
            url: "/api/workspaces/current/members",
            payload: { friendId: benFriend, role: "editor" },
          },
          space.id,
        )
      ).statusCode,
    ).toBe(201);

    // An Event with a task in its scope, a People card, a guest's share of
    // the task, and a share waiting on Priya's invitation.
    const event = await create(
      ana,
      space.id,
      "/api/events",
      { displayName: "Vows" },
      eventResponseSchema,
    );
    const task = await create(
      ana,
      space.id,
      "/api/tasks",
      { displayName: "Book the hall", permissionScopeId: event.id },
      taskResponseSchema,
    );
    const priya = await create(
      ana,
      space.id,
      "/api/persons",
      {
        displayName: "Priya",
        contacts: [{ kind: "email", value: "priya@example.test" }],
      },
      personResponseSchema,
    );
    expect(
      (
        await request(
          ana,
          {
            method: "POST",
            url: "/api/shares",
            payload: {
              resourceId: task.id,
              friendId: cyFriend,
              role: "viewer",
            },
          },
          space.id,
        )
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await request(
          ana,
          {
            method: "POST",
            url: "/api/shares/pending",
            payload: {
              resourceId: event.id,
              personId: priya.id,
              role: "viewer",
            },
          },
          space.id,
        )
      ).statusCode,
    ).toBe(201);

    expect(await deletable(ana, space.id)).toEqual({
      deletable: false,
      reason: "holds_records",
      liveRecords: 3,
      trashRecords: 0,
      memberCount: 2,
    });
    expect(await deletable(ben, space.id)).toMatchObject({
      deletable: false,
      reason: "not_owner",
    });
    expect(await deletable(ana, ana.workspace.id)).toMatchObject({
      deletable: false,
      reason: "personal",
    });
    // A guest enters the space through the share but reads no preview.
    expect((await deletionOf(cy, space.id)).statusCode).toBe(404);

    const byEditor = await deleteSpace(ben, space.id);
    expect(byEditor.statusCode).toBe(403);
    expect(byEditor.json().error.code).toBe("space_forbidden");
    expect((await deleteSpace(cy, space.id)).json().error.code).toBe(
      "space_forbidden",
    );
    const personal = await deleteSpace(ana, ana.workspace.id);
    expect(personal.statusCode).toBe(400);
    expect(personal.json().error.code).toBe("space_personal");
    const holding = await deleteSpace(ana, space.id);
    expect(holding.statusCode).toBe(409);
    expect(holding.json().error).toEqual({
      code: "space_not_empty",
      message:
        "The space holds records; move them to another space or to Trash first.",
    });

    // The Event goes to Trash alone; its task stays live under it and is in
    // Trash with it. With the card gone too, only Trash is left.
    await trash(ana, space.id, event.id);
    expect(await deletable(ana, space.id)).toMatchObject({
      reason: "holds_records",
      liveRecords: 1,
      trashRecords: 2,
    });
    await trash(ana, space.id, priya.id);
    expect(await deletable(ana, space.id)).toEqual({
      deletable: true,
      reason: null,
      liveRecords: 0,
      trashRecords: 3,
      memberCount: 2,
    });
    expect((await spacesOf(cy)).map((workspace) => workspace.id)).toContain(
      space.id,
    );
    const database = testDatabase.connection.db;
    const revisionIds = async () =>
      (
        await database
          .select({ id: objectRevisions.id })
          .from(objectRevisions)
          .where(
            inArray(objectRevisions.objectId, [event.id, task.id, priya.id]),
          )
          .orderBy(asc(objectRevisions.id))
      ).map((revision) => revision.id);
    const spaceHistory = () =>
      database
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.workspaceId, space.id))
        .orderBy(asc(auditEvents.id));
    const revisionsBefore = await revisionIds();
    const historyBefore = (await spaceHistory()).map((audit) => audit.id);

    const deleted = await deleteSpace(ana, space.id);
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe("");

    // Every member and the guest lose the space, and a session in it is
    // refused; the guest's share of the task is gone.
    for (const session of [ana, ben, cy]) {
      expect(
        (await spacesOf(session)).map((workspace) => workspace.id),
      ).not.toContain(space.id);
      const inSpace = await request(
        session,
        { method: "GET", url: "/api/auth/session" },
        space.id,
      );
      expect(inSpace.statusCode).toBe(404);
      expect(inSpace.json().error.code).toBe("workspace_unavailable");
    }
    expect(
      (await request(cy, { method: "GET", url: `/api/objects/${task.id}` }))
        .statusCode,
    ).toBe(404);
    const again = await deleteSpace(ana, space.id);
    expect(again.statusCode).toBe(404);
    expect(again.json().error.code).toBe("workspace_unavailable");

    // The space is marked, not purged: its records, revisions, and history
    // stay; its members, live grants, and waiting shares do not.
    const [row] = await database
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, space.id));
    expect(row).toMatchObject({ deletedBy: ana.user.id });
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(
      await database
        .select({ id: objects.id })
        .from(objects)
        .where(eq(objects.workspaceId, space.id)),
    ).toHaveLength(3);
    expect(await revisionIds()).toEqual(revisionsBefore);
    // Events written in one transaction share a millisecond, so the
    // deletion's are compared in the order of their actions.
    const history = await spaceHistory();
    expect(history.map((audit) => audit.id)).toEqual(
      expect.arrayContaining(historyBefore),
    );
    const added = history
      .filter((audit) => !historyBefore.includes(audit.id))
      .sort((a, b) => a.action.localeCompare(b.action));
    expect(
      await database
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, space.id)),
    ).toEqual([]);
    expect(
      await database
        .select()
        .from(resourceGrants)
        .where(eq(resourceGrants.workspaceId, space.id)),
    ).toEqual([]);
    expect(
      await database
        .select({ status: pendingShares.status })
        .from(pendingShares)
        .where(eq(pendingShares.workspaceId, space.id)),
    ).toEqual([{ status: "revoked" }]);
    const [grantId] = added
      .filter((a) => a.action === "resource.share_revoked")
      .map((a) => a.metadata.grantId);
    expect(
      added.map((a) => ({
        action: a.action,
        resourceId: a.resourceId,
        actorId: a.actorId,
        metadata: a.metadata,
      })),
    ).toEqual([
      {
        action: "resource.share_queue_revoked",
        resourceId: event.id,
        actorId: ana.user.id,
        metadata: {
          pendingShareId: expect.any(String),
          reason: "workspace_deleted",
        },
      },
      {
        action: "resource.share_revoked",
        resourceId: task.id,
        actorId: ana.user.id,
        metadata: {
          grantId,
          principalId: cy.user.id,
          role: "viewer",
          reason: "workspace_deleted",
        },
      },
      {
        action: "workspace.deleted",
        resourceId: null,
        actorId: ana.user.id,
        metadata: {
          displayName: "Our wedding",
          members: [
            { userId: ana.user.id, role: "owner" },
            { userId: ben.user.id, role: "editor" },
          ].sort((a, b) => (a.userId < b.userId ? -1 : 1)),
          grants: [
            {
              grantId,
              resourceId: task.id,
              principalId: cy.user.id,
              role: "viewer",
            },
          ],
          pendingShares: 1,
          trashRecords: 3,
        },
      },
    ]);

    // An Event cannot move there, and a new space may take its name.
    const home = await create(
      ana,
      ana.workspace.id,
      "/api/events",
      { displayName: "Errands" },
      eventResponseSchema,
    );
    const targets = await request(ana, {
      method: "GET",
      url: `/api/objects/${home.id}/move/targets`,
    });
    expect(targets.statusCode).toBe(200);
    expect(
      objectMoveTargetsResponseSchema
        .parse(targets.json())
        .items.map((item) => item.workspace.id),
    ).not.toContain(space.id);
    const renewed = await createSpace(ana, "Our wedding");
    expect(renewed.id).not.toBe(space.id);
    expect(await spacesOf(ana)).toContainEqual(renewed);
  });

  it("refuses a record created while its space is being deleted", async () => {
    const ana = await signIn("ana@example.test", "Ana");
    const space = await createSpace(ana, "Our wedding");

    // The deletion holds the space's row until it commits; a record created
    // meanwhile waits for it, then finds the space gone.
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const holder = testDatabase.connection.sql.begin(async (sql) => {
      await sql`SELECT chronelle_workspace_delete(${space.id}, ${ana.user.id}, ${createId()}, now())`;
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    let settled = false;
    const created = request(
      ana,
      { method: "POST", url: "/api/events", payload: { displayName: "Late" } },
      space.id,
    ).then((response) => {
      settled = true;
      return response;
    });
    await new Promise((wait) => setTimeout(wait, 300));
    expect(settled).toBe(false);
    release.resolve();
    await holder;
    const refused = await created;
    expect(refused.statusCode).toBe(404);
    expect(
      await testDatabase.connection.db
        .select({ id: objects.id })
        .from(objects)
        .where(eq(objects.workspaceId, space.id)),
    ).toEqual([]);
  });

  it("waits for a record being created and then refuses to delete the space", async () => {
    const ana = await signIn("ana@example.test", "Ana");
    const space = await createSpace(ana, "Our wedding");

    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const holder = testDatabase.connection.sql.begin(async (sql) => {
      await sql`SELECT chronelle_event_create(${space.id}, ${ana.user.id}, ${createId()}, ${JSON.stringify({ displayName: "Early" })}::jsonb)`;
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    let settled = false;
    const deletion = deleteSpace(ana, space.id).then((response) => {
      settled = true;
      return response;
    });
    await new Promise((wait) => setTimeout(wait, 300));
    expect(settled).toBe(false);
    release.resolve();
    await holder;
    const refused = await deletion;
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("space_not_empty");
    const [row] = await testDatabase.connection.db
      .select({ deletedAt: workspaces.deletedAt })
      .from(workspaces)
      .where(eq(workspaces.id, space.id));
    expect(row).toEqual({ deletedAt: null });
  });
});
