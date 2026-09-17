import { resolve } from "node:path";

import {
  auditEvents,
  createId,
  objects,
  resourceGrants,
  users,
  workspaceMembers,
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
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthIdentity } from "../src/authentication/auth-provider.js";
import { WorkspaceUnavailableError } from "../src/errors.js";
import { CloudBaseIdentityStore } from "../src/identity/cloudbase-identity-store.js";
import {
  PostgresIdentityStore,
  type IdentityStore,
} from "../src/identity/identity-store.js";

// chronelle_identity_sign_in and the gateway reads must leave and return
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
      seen.guestWorkspaces = (
        await store.listAccessibleWorkspaces(guest.user.id)
      )
        .map((workspace) => workspace.displayName)
        .sort();
      seen.ownerWorkspaces = (
        await store.listAccessibleWorkspaces(owner.user.id)
      )
        .map((workspace) => workspace.displayName)
        .sort();
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
      guestWorkspaces: ["Person guest's workspace", "Person owner's workspace"],
      ownerWorkspaces: ["Person owner's workspace"],
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

  it("keeps the same language on the account and refuses the same tags", async () => {
    const db = database.connection.db;
    const results: Record<string, unknown> = {};
    for (const [name, store] of backends()) {
      const signedIn = await store.signIn(identity(`lang-${name}`), createId());
      expect(signedIn.user.locale).toBeNull();
      const chosen = await store.updateLocale(signedIn.user.id, "zh-Hant");
      const read = await store.resolveSession(
        identity(`lang-${name}`),
        undefined,
      );
      const cleared = await store.updateLocale(signedIn.user.id, null);
      const refused = await store
        .updateLocale(signedIn.user.id, "not a tag")
        .then(() => "accepted")
        .catch((error: unknown) =>
          error instanceof Error ? "refused" : "unknown",
        );
      const unknownUser = await store
        .updateLocale(createId(), "en")
        .then(() => "accepted")
        .catch((error: unknown) =>
          error instanceof Error ? "refused" : "unknown",
        );
      const [row] = await db
        .select({ locale: users.locale })
        .from(users)
        .where(eq(users.id, signedIn.user.id));
      results[name] = {
        chosen: chosen.locale,
        read: read?.user.locale,
        cleared: cleared.locale,
        stored: row?.locale,
        refused,
        unknownUser,
        touched: chosen.updatedAt >= signedIn.user.updatedAt,
      };
    }
    expect(results.cloudbase).toEqual(results.postgres);
    expect(results.postgres).toEqual({
      chosen: "zh-Hant",
      read: "zh-Hant",
      cleared: null,
      stored: null,
      refused: "refused",
      unknownUser: "refused",
      touched: true,
    });
  });
});
