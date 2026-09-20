import { resolve } from "node:path";

import {
  auditEvents,
  createId,
  objects,
  resourceGrants,
  sections,
  users,
  workspaceMembers,
  workspaces,
  type UserRow,
} from "@chronelle/db";
import {
  applyMigrations,
  createCloudBaseLiveReader,
  createCloudBaseRpcDouble,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import { EventPlanningObjectService } from "@chronelle/object-model";
import { and, eq } from "drizzle-orm";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AuthIdentity } from "../src/authentication/auth-provider.js";
import { CloudBaseSessionStore } from "../src/authentication/cloudbase-session-store.js";
import { SessionAuthProvider } from "../src/authentication/session-auth-provider.js";
import { HttpError, WorkspaceUnavailableError } from "../src/errors.js";
import { CloudBaseIdentityStore } from "../src/identity/cloudbase-identity-store.js";
import {
  PostgresIdentityStore,
  type IdentityStore,
} from "../src/identity/identity-store.js";
import { WorkspaceIdentityService } from "../src/identity/workspace-identity-service.js";
import { registerRequestContext } from "../src/request-context.js";

// The identity RPCs and gateway reads must leave and return
// what the PostgreSQL identity store leaves and returns: the user, the
// personal workspace with its Owner membership, the audit event of each
// sign-in, and the sessions and workspace lists the same access rules
// yield (membership, an unexpired grant on a live object, or an Owner grant
// on any object).

let database: TestDatabase;
let reference: IdentityStore;
let cloudbase: IdentityStore;

const clock = () => new Date("2030-08-01T12:00:00.000Z");

const identity = (suffix: string): AuthIdentity => ({
  provider: "test",
  subject: `subject-${suffix}`,
  email: `${suffix}@example.test`,
  displayName: `Person ${suffix}`,
});

beforeAll(async () => {
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
  reference = new PostgresIdentityStore(database.connection.db);
  // Both stores evaluate grant expiry against the wall clock, which the
  // PostgreSQL authorization evaluator does not take from a parameter.
  cloudbase = new CloudBaseIdentityStore({
    ...createCloudBaseLiveReader(database.connection.db),
    rpc: createCloudBaseRpcDouble(database.connection.sql),
  });
});

afterAll(async () => {
  await database?.close();
});

const backends = () =>
  [
    ["postgres", reference],
    ["cloudbase", cloudbase],
  ] as const;

/** Rows without their per-run identifiers and clocks. */
function shape(rows: {
  user: { displayName: string; email: string | null; identityProvider: string };
  workspace: {
    displayName: string;
    personalOwnerId: string | null;
    createdBy: string;
  };
}) {
  return {
    user: {
      displayName: rows.user.displayName,
      email: rows.user.email,
      identityProvider: rows.user.identityProvider,
    },
    workspace: {
      displayName: rows.workspace.displayName,
      ownsItself:
        rows.workspace.personalOwnerId !== null &&
        rows.workspace.personalOwnerId === rows.workspace.createdBy,
    },
  };
}

describe.sequential("CloudBase identity store", () => {
  it("uses two gateway calls per authenticated request and rechecks live access", async () => {
    const signedIn = await reference.signIn(
      identity("request-budget"),
      createId(),
    );
    const client = {
      ...createCloudBaseLiveReader(database.connection.db),
      rpc: createCloudBaseRpcDouble(database.connection.sql),
    };
    const rpc = vi.spyOn(client, "rpc");
    const select = vi.spyOn(client, "select");
    const sessions = new SessionAuthProvider(new CloudBaseSessionStore(client));
    const issued = await sessions.issue(signedIn.user, "test");
    const app = Fastify();
    registerRequestContext(app, {
      authProvider: sessions,
      identity: new WorkspaceIdentityService(
        database.connection.db,
        new CloudBaseIdentityStore(client),
      ),
    });
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof HttpError)
        return reply.code(error.statusCode).send({ code: error.code });
      throw error;
    });
    app.get(
      "/session",
      { preHandler: app.authenticate },
      async (request) => request.principal,
    );
    const request = () =>
      app.inject({
        method: "GET",
        url: "/session",
        headers: { authorization: `Bearer ${issued.accessToken}` },
      });
    try {
      rpc.mockClear();
      const response = await request();
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        type: "user",
        userId: signedIn.user.id,
        workspaceId: signedIn.workspace.id,
      });
      expect(rpc.mock.calls.map(([name]) => name)).toEqual([
        "chronelle_session_resolve",
        "chronelle_identity_session_resolve",
      ]);
      expect(select).not.toHaveBeenCalled();

      await database.connection.db
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, signedIn.workspace.id),
            eq(workspaceMembers.userId, signedIn.user.id),
          ),
        );
      rpc.mockClear();
      const denied = await request();
      expect(denied.statusCode).toBe(404);
      expect(denied.json()).toEqual({ code: "workspace_unavailable" });
      expect(rpc).toHaveBeenCalledTimes(2);

      await sessions.revoke(issued.accessToken, createId());
      rpc.mockClear();
      const revoked = await request();
      expect(revoked.statusCode).toBe(401);
      expect(revoked.json()).toEqual({ code: "unauthenticated" });
      expect(rpc.mock.calls.map(([name]) => name)).toEqual([
        "chronelle_session_resolve",
      ]);
    } finally {
      await app.close();
    }
  });

  it("keeps object routing and narrowed grants equivalent to PostgreSQL", async () => {
    const db = database.connection.db;
    const owner = await reference.signIn(identity("routing-owner"), createId());
    const guestIdentity = identity("routing-guest");
    const guest = await reference.signIn(guestIdentity, createId());
    const service = new EventPlanningObjectService(db);
    const shared = await service.createEvent(
      {
        principal: {
          type: "user",
          userId: owner.user.id,
          workspaceId: owner.workspace.id,
        },
        requestId: createId(),
      },
      { displayName: "Shared planning" },
    );
    const sectionId = createId();
    await db.insert(sections).values({
      id: sectionId,
      workspaceId: owner.workspace.id,
      eventId: shared.id,
      view: "todos",
      name: "Preparation",
      rank: "00000000500",
      createdBy: owner.user.id,
    });
    const grantId = createId();
    await db.insert(resourceGrants).values({
      id: grantId,
      workspaceId: owner.workspace.id,
      resourceId: shared.id,
      principalId: guest.user.id,
      role: "viewer",
      scope: "todos",
      sectionId,
      grantedBy: owner.user.id,
    });
    for (const [, store] of backends()) {
      // A narrowed grant admits the workspace; individual resources and
      // views still require their own authorization checks.
      expect(
        await store.resolveSession(guestIdentity, createId(), shared.id),
      ).toEqual({ user: guest.user, workspace: owner.workspace });
      expect(
        await store.resolveSession(guestIdentity, undefined, createId()),
      ).toEqual({ user: guest.user, workspace: guest.workspace });
    }
    await db.delete(resourceGrants).where(eq(resourceGrants.id, grantId));
    for (const [, store] of backends()) {
      expect(
        await store.resolveSession(guestIdentity, undefined, shared.id),
      ).toEqual({ user: guest.user, workspace: guest.workspace });
      await expect(
        store.resolveSession(guestIdentity, owner.workspace.id, shared.id),
      ).rejects.toBeInstanceOf(WorkspaceUnavailableError);
    }
  });

  it("requires a personal workspace even when another workspace was requested", async () => {
    const person = identity("no-personal-workspace");
    const signedIn = await reference.signIn(person, createId());
    await database.connection.db
      .update(workspaces)
      .set({ personalOwnerId: null })
      .where(eq(workspaces.id, signedIn.workspace.id));
    for (const [, store] of backends()) {
      await expect(
        store.resolveSession(person, signedIn.workspace.id),
      ).resolves.toBeNull();
    }
  });

  it("uses the request's observation time at the exact grant-expiry boundary", async () => {
    const db = database.connection.db;
    const owner = await reference.signIn(identity("expiry-owner"), createId());
    const guestIdentity = identity("expiry-guest");
    const guest = await reference.signIn(guestIdentity, createId());
    const shared = await new EventPlanningObjectService(db).createEvent(
      {
        principal: {
          type: "user",
          userId: owner.user.id,
          workspaceId: owner.workspace.id,
        },
        requestId: createId(),
      },
      { displayName: "Expiring share" },
    );
    const expiresAt = new Date(Date.now() + 60_000);
    await db.insert(resourceGrants).values({
      id: createId(),
      workspaceId: owner.workspace.id,
      resourceId: shared.id,
      principalId: guest.user.id,
      role: "viewer",
      grantedBy: owner.user.id,
      expiresAt,
    });
    let observedAt = new Date(expiresAt.getTime() - 1);
    const store = new CloudBaseIdentityStore(
      {
        ...createCloudBaseLiveReader(db),
        rpc: createCloudBaseRpcDouble(database.connection.sql),
      },
      () => observedAt,
    );
    await expect(
      store.resolveSession(guestIdentity, owner.workspace.id),
    ).resolves.toEqual({ user: guest.user, workspace: owner.workspace });
    observedAt = expiresAt;
    await expect(
      store.resolveSession(guestIdentity, owner.workspace.id),
    ).rejects.toBeInstanceOf(WorkspaceUnavailableError);
  });

  it("signs in with the same rows, membership, and audits", async () => {
    const results = [];
    for (const [label, store] of backends()) {
      const person = identity(label);
      const first = await store.signIn(person, createId());
      const second = await store.signIn(
        { ...person, displayName: "Renamed later", email: null },
        createId(),
      );
      const db = database.connection.db;
      const [membership] = await db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, first.workspace.id),
            eq(workspaceMembers.userId, first.user.id),
          ),
        );
      const audits = await db
        .select({ action: auditEvents.action, metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(eq(auditEvents.workspaceId, first.workspace.id))
        // One sign-in writes two audits in one transaction; the SQL uuidv7
        // does not order ids within a millisecond, the action does.
        .orderBy(auditEvents.createdAt, auditEvents.action, auditEvents.id);
      results.push({
        first: { ...shape(first), createdWorkspace: first.createdWorkspace },
        second: {
          ...shape(second),
          createdWorkspace: second.createdWorkspace,
          sameUser: second.user.id === first.user.id,
          sameWorkspace: second.workspace.id === first.workspace.id,
        },
        membership,
        audits,
      });
    }
    const [postgres, cloud] = results;
    expect(cloud).toEqual({
      ...postgres,
      first: {
        ...postgres?.first,
        user: {
          ...postgres?.first.user,
          displayName: "Person cloudbase",
          email: "cloudbase@example.test",
        },
        workspace: {
          ...postgres?.first.workspace,
          displayName: "Person cloudbase's workspace",
        },
      },
      second: {
        ...postgres?.second,
        user: {
          ...postgres?.second.user,
          displayName: "Person cloudbase",
          email: "cloudbase@example.test",
        },
        workspace: {
          ...postgres?.second.workspace,
          displayName: "Person cloudbase's workspace",
        },
      },
    });
    expect(postgres).toMatchObject({
      first: { createdWorkspace: true, workspace: { ownsItself: true } },
      second: { createdWorkspace: false, sameUser: true, sameWorkspace: true },
      membership: { role: "owner" },
      audits: [
        {
          action: "workspace.personal_created",
          metadata: { identityProvider: "test" },
        },
        {
          action: "identity.signed_in",
          metadata: { identityProvider: "test" },
        },
      ],
    });
  });

  it("resolves the same sessions and workspace lists", async () => {
    const db = database.connection.db;
    const owner = await reference.signIn(identity("owner"), createId());
    const guest = await reference.signIn(identity("guest"), createId());
    const objectService = new EventPlanningObjectService(db, clock);
    const context = {
      principal: {
        type: "user" as const,
        userId: owner.user.id,
        workspaceId: owner.workspace.id,
      },
      requestId: createId(),
    };
    const shared = await objectService.createEvent(context, {
      displayName: "Shared",
    });
    const trashed = await objectService.createEvent(context, {
      displayName: "Trashed",
    });
    await objectService.softDelete(context, trashed.id, 1);
    const grant = (
      resourceId: string,
      principalId: string,
      role: "owner" | "editor" | "viewer",
      expiresAt: Date | null = null,
    ) =>
      db.insert(resourceGrants).values({
        id: createId(),
        workspaceId: owner.workspace.id,
        resourceId,
        principalId,
        role,
        grantedBy: owner.user.id,
        // A grant may not expire before its creation, so an expired grant is created in the past.
        ...(expiresAt !== null && {
          createdAt: new Date(expiresAt.getTime() - 1_000),
          expiresAt,
        }),
      });
    const results = [];
    for (const [, store] of backends()) {
      const seen: Record<string, unknown> = {};
      const attempt = async (label: string, run: () => Promise<unknown>) => {
        try {
          const value = await run();
          seen[label] = value === null ? null : shape(value as never);
        } catch (error) {
          seen[label] = (error as Error).constructor.name;
        }
      };
      await attempt("personal", () =>
        store.resolveSession(identity("owner"), undefined),
      );
      await attempt("unknown", () =>
        store.resolveSession(identity("nobody"), undefined),
      );
      await attempt("guestBeforeGrant", () =>
        store.resolveSession(identity("guest"), owner.workspace.id),
      );
      await attempt("missingWorkspace", () =>
        store.resolveSession(identity("owner"), createId()),
      );
      // A viewer grant on a deleted object grants nothing; an Owner grant on it still does.
      await grant(trashed.id, guest.user.id, "viewer");
      await attempt("guestDeletedViewer", () =>
        store.resolveSession(identity("guest"), owner.workspace.id),
      );
      await grant(
        shared.id,
        guest.user.id,
        "viewer",
        new Date(Date.now() - 60_000),
      );
      await attempt("guestExpired", () =>
        store.resolveSession(identity("guest"), owner.workspace.id),
      );
      await db
        .update(resourceGrants)
        .set({ expiresAt: new Date(Date.now() + 3_600_000) })
        .where(
          and(
            eq(resourceGrants.resourceId, shared.id),
            eq(resourceGrants.principalId, guest.user.id),
          ),
        );
      await attempt("guestGranted", () =>
        store.resolveSession(identity("guest"), owner.workspace.id),
      );
      const listed = (userId: string) =>
        store.listAccessibleWorkspaces(userId).then((rows) =>
          rows
            .map((workspace) => ({
              displayName: workspace.displayName,
              ownerDisplayName: workspace.ownerDisplayName,
              role: workspace.role,
            }))
            .sort((first, second) =>
              first.displayName.localeCompare(second.displayName),
            ),
        );
      seen.guestWorkspaces = await listed(guest.user.id);
      seen.ownerWorkspaces = await listed(owner.user.id);
      await db
        .delete(resourceGrants)
        .where(eq(resourceGrants.principalId, guest.user.id));
      await grant(trashed.id, guest.user.id, "owner");
      await attempt("guestDeletedOwner", () =>
        store.resolveSession(identity("guest"), owner.workspace.id),
      );
      await db
        .delete(resourceGrants)
        .where(eq(resourceGrants.principalId, guest.user.id));
      results.push(seen);
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]).toEqual({
      personal: shape(owner),
      unknown: null,
      guestBeforeGrant: WorkspaceUnavailableError.name,
      missingWorkspace: WorkspaceUnavailableError.name,
      guestDeletedViewer: WorkspaceUnavailableError.name,
      guestExpired: WorkspaceUnavailableError.name,
      guestGranted: {
        user: shape(guest).user,
        workspace: shape(owner).workspace,
      },
      // A workspace reached through a share alone carries its owner's
      // name and no role; a membership carries the role.
      guestWorkspaces: [
        {
          displayName: "Person guest's workspace",
          ownerDisplayName: "Person guest",
          role: "owner",
        },
        {
          displayName: "Person owner's workspace",
          ownerDisplayName: "Person owner",
          role: null,
        },
      ],
      ownerWorkspaces: [
        {
          displayName: "Person owner's workspace",
          ownerDisplayName: "Person owner",
          role: "owner",
        },
      ],
      guestDeletedOwner: {
        user: shape(guest).user,
        workspace: shape(owner).workspace,
      },
    });
    expect(
      await db
        .select({ id: objects.id })
        .from(objects)
        .where(eq(objects.workspaceId, owner.workspace.id)),
    ).toHaveLength(2);
  });

  it("keeps the same preferences on the account, merges one key at a time, and refuses the same values", async () => {
    const db = database.connection.db;
    const preferenceColumns = {
      locale: users.locale,
      timeZone: users.timeZone,
      hourCycle: users.hourCycle,
      weekStart: users.weekStart,
      rail: users.rail,
      eventTabs: users.eventTabs,
      workspaceRecency: users.workspaceRecency,
    };
    const kyoto = "01a0b355-cad8-73d2-89f8-0a12abf666a8";
    const lisbon = "01a0b355-cad8-73d2-89f8-0a12abf666a9";
    const outcome = (attempt: Promise<unknown>) =>
      attempt
        .then(() => "accepted")
        .catch((error: unknown) =>
          error instanceof Error ? "refused" : "unknown",
        );
    const results: Record<string, unknown> = {};
    for (const [name, store] of backends()) {
      const signedIn = await store.signIn(identity(`pref-${name}`), createId());
      expect(signedIn.user).toMatchObject({
        locale: null,
        timeZone: null,
        hourCycle: null,
        weekStart: null,
        rail: {},
        eventTabs: {},
        workspaceRecency: {},
      });
      const chosen = await store.updatePreferences(signedIn.user.id, {
        locale: "zh-Hant",
        timeZone: "Asia/Taipei",
        rail: { order: ["people", "events", "tasks"], hidden: ["tasks"] },
        eventTabs: {
          [kyoto]: { order: ["todos", "overview"], removed: ["timeline"] },
        },
        workspaceRecency: { [kyoto]: "2026-09-20T00:10:00.000Z" },
      });
      const merged = await store.updatePreferences(signedIn.user.id, {
        hourCycle: "h23",
        weekStart: 7,
        eventTabs: { [lisbon]: { hidden: ["files"] } },
        workspaceRecency: { [lisbon]: "2026-09-19T08:00:00+08:00" },
      });
      const read = await store.resolveSession(
        identity(`pref-${name}`),
        undefined,
      );
      const untouched = await store.updatePreferences(signedIn.user.id, {});
      const cleared = await store.updatePreferences(signedIn.user.id, {
        locale: null,
        hourCycle: null,
        rail: null,
        eventTabs: { [kyoto]: { hidden: ["sharing"] }, [lisbon]: null },
        workspaceRecency: { [kyoto]: "2026-09-21T00:00:00Z", [lisbon]: null },
      });
      const crowded = await store.updatePreferences(signedIn.user.id, {
        workspaceRecency: Object.fromEntries(
          Array.from({ length: 60 }, (_, index) => [
            `01a0b355-cad8-73d2-89f8-${String(index).padStart(12, "0")}`,
            `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
          ]),
        ),
      });
      const refusals = {
        locale: await outcome(
          store.updatePreferences(signedIn.user.id, { locale: "not a tag" }),
        ),
        timeZone: await outcome(
          store.updatePreferences(signedIn.user.id, {
            timeZone: "Asia Shanghai",
          }),
        ),
        hourCycle: await outcome(
          store.updatePreferences(signedIn.user.id, {
            hourCycle: "h11" as "h12",
          }),
        ),
        weekStart: await outcome(
          store.updatePreferences(signedIn.user.id, { weekStart: 2 as 1 }),
        ),
        railList: await outcome(
          store.updatePreferences(signedIn.user.id, {
            rail: ["events"] as unknown as { order: string[] },
          }),
        ),
        railKeys: await outcome(
          store.updatePreferences(signedIn.user.id, {
            rail: { order: [1] as unknown as string[] },
          }),
        ),
        eventTabsKey: await outcome(
          store.updatePreferences(signedIn.user.id, {
            eventTabs: { plan: { order: ["todos"] } },
          }),
        ),
        eventTabsShape: await outcome(
          store.updatePreferences(signedIn.user.id, {
            eventTabs: { [kyoto]: { order: "todos" as unknown as string[] } },
          }),
        ),
        eventTabsLength: await outcome(
          store.updatePreferences(signedIn.user.id, {
            eventTabs: {
              [kyoto]: {
                hidden: Array.from({ length: 41 }, (_, index) => `k${index}`),
              },
            },
          }),
        ),
        eventTabsCount: await outcome(
          store.updatePreferences(signedIn.user.id, {
            eventTabs: Object.fromEntries(
              Array.from({ length: 200 }, (_, index) => [
                `01a0b355-cad8-73d2-89f8-${String(index).padStart(12, "0")}`,
                {},
              ]),
            ),
          }),
        ),
        recencyKey: await outcome(
          store.updatePreferences(signedIn.user.id, {
            workspaceRecency: { plan: "2026-09-21T00:00:00Z" },
          }),
        ),
        recencyShape: await outcome(
          store.updatePreferences(signedIn.user.id, {
            workspaceRecency: [kyoto] as unknown as Record<string, string>,
          }),
        ),
        recencyInstant: await outcome(
          store.updatePreferences(signedIn.user.id, {
            workspaceRecency: { [kyoto]: "yesterday" },
          }),
        ),
        unknownUser: await outcome(
          store.updatePreferences(createId(), { locale: "en" }),
        ),
      };
      const [row] = await db
        .select(preferenceColumns)
        .from(users)
        .where(eq(users.id, signedIn.user.id));
      const shape = (user: UserRow) => ({
        locale: user.locale,
        timeZone: user.timeZone,
        hourCycle: user.hourCycle,
        weekStart: user.weekStart,
        rail: user.rail,
        eventTabs: user.eventTabs,
        workspaceRecency: user.workspaceRecency,
      });
      results[name] = {
        chosen: shape(chosen),
        merged: shape(merged),
        read: read === null ? null : shape(read.user),
        untouched: shape(untouched),
        cleared: shape(cleared),
        crowded: Object.keys(crowded.workspaceRecency).sort(),
        stored: row,
        refusals,
        touched: chosen.updatedAt >= signedIn.user.updatedAt,
      };
    }
    expect(results.cloudbase).toEqual(results.postgres);
    expect(results.postgres).toEqual({
      chosen: {
        locale: "zh-Hant",
        timeZone: "Asia/Taipei",
        hourCycle: null,
        weekStart: null,
        rail: { order: ["people", "events", "tasks"], hidden: ["tasks"] },
        eventTabs: {
          [kyoto]: { order: ["todos", "overview"], removed: ["timeline"] },
        },
        workspaceRecency: { [kyoto]: "2026-09-20T00:10:00.000Z" },
      },
      merged: {
        locale: "zh-Hant",
        timeZone: "Asia/Taipei",
        hourCycle: "h23",
        weekStart: 7,
        rail: { order: ["people", "events", "tasks"], hidden: ["tasks"] },
        eventTabs: {
          [kyoto]: { order: ["todos", "overview"], removed: ["timeline"] },
          [lisbon]: { hidden: ["files"] },
        },
        workspaceRecency: {
          [kyoto]: "2026-09-20T00:10:00.000Z",
          [lisbon]: "2026-09-19T08:00:00+08:00",
        },
      },
      read: {
        locale: "zh-Hant",
        timeZone: "Asia/Taipei",
        hourCycle: "h23",
        weekStart: 7,
        rail: { order: ["people", "events", "tasks"], hidden: ["tasks"] },
        eventTabs: {
          [kyoto]: { order: ["todos", "overview"], removed: ["timeline"] },
          [lisbon]: { hidden: ["files"] },
        },
        workspaceRecency: {
          [kyoto]: "2026-09-20T00:10:00.000Z",
          [lisbon]: "2026-09-19T08:00:00+08:00",
        },
      },
      untouched: {
        locale: "zh-Hant",
        timeZone: "Asia/Taipei",
        hourCycle: "h23",
        weekStart: 7,
        rail: { order: ["people", "events", "tasks"], hidden: ["tasks"] },
        eventTabs: {
          [kyoto]: { order: ["todos", "overview"], removed: ["timeline"] },
          [lisbon]: { hidden: ["files"] },
        },
        workspaceRecency: {
          [kyoto]: "2026-09-20T00:10:00.000Z",
          [lisbon]: "2026-09-19T08:00:00+08:00",
        },
      },
      cleared: {
        locale: null,
        timeZone: "Asia/Taipei",
        hourCycle: null,
        weekStart: 7,
        rail: {},
        eventTabs: { [kyoto]: { hidden: ["sharing"] } },
        workspaceRecency: { [kyoto]: "2026-09-21T00:00:00Z" },
      },
      // The 50 most recent instants stay: the oldest days fall off, the
      // key deciding between equal instants.
      crowded: [
        kyoto,
        ...Array.from({ length: 60 }, (_, index) => index)
          .filter((index) => index % 28 >= 4 || index === 3)
          .map(
            (index) =>
              `01a0b355-cad8-73d2-89f8-${String(index).padStart(12, "0")}`,
          ),
      ].sort(),
      stored: {
        locale: null,
        timeZone: "Asia/Taipei",
        hourCycle: null,
        weekStart: 7,
        rail: {},
        eventTabs: { [kyoto]: { hidden: ["sharing"] } },
        workspaceRecency: expect.any(Object),
      },
      refusals: {
        locale: "refused",
        timeZone: "refused",
        hourCycle: "refused",
        weekStart: "refused",
        railList: "refused",
        railKeys: "refused",
        eventTabsKey: "refused",
        eventTabsShape: "refused",
        eventTabsLength: "refused",
        eventTabsCount: "refused",
        recencyKey: "refused",
        recencyShape: "refused",
        recencyInstant: "refused",
        unknownUser: "refused",
      },
      touched: true,
    });
  });
});
