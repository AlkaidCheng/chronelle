import { resolve } from "node:path";

import { auditEvents, disconnectedDatabase } from "@livtales/db";
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
  sentInvitationSchema,
  sessionResponseSchema,
  workspaceMemberListResponseSchema,
  workspaceMemberSchema,
} from "@livtales/schemas";
import { asc, eq } from "drizzle-orm";
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
});
