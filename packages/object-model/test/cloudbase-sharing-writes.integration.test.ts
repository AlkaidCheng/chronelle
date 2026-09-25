import {
  AuthorizationDeniedError,
  InvalidShareError,
  PrincipalUnavailableError,
  ResourceGrantService,
} from "@livtales/authorization";
import {
  auditEvents,
  createId,
  resourceGrants,
  userConnections,
  users,
  workspaceMembers,
} from "@livtales/db";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseSharingWriteRepository } from "../src/cloudbase-sharing-write-repository.js";
import { InvalidObjectStateError, ObjectConflictError } from "../src/errors.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import {
  createWriteHarness,
  failure,
  ledger,
  mutationContext,
  shape,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// chronelle_resource_share, chronelle_resource_share_revoke,
// chronelle_resource_share_leave, and
// chronelle_object_scope_update must leave what ResourceGrantService and
// EventPlanningObjectService.updatePermissionScope leave: the grant rows,
// the audit events, and the scope revision; and they must refuse the same
// requests with the same errors.

let harness: WriteHarness;
let granteeId: string;
let reference: {
  shares: ResourceGrantService;
  objects: EventPlanningObjectService;
};
let cloudbase: {
  shares: ResourceGrantService;
  objects: EventPlanningObjectService;
};

const clock = () => new Date("2030-08-01T12:00:00.000Z");
const granteeEmail = "grantee@example.test";

beforeAll(async () => {
  harness = await createWriteHarness("Sharing writes");
  const db = harness.database.connection.db;
  granteeId = createId();
  await db.insert(users).values({
    id: granteeId,
    identityProvider: "test",
    providerSubject: granteeId,
    displayName: "Grantee",
    email: granteeEmail,
  });
  const adapter = new CloudBaseSharingWriteRepository(harness);
  reference = {
    shares: new ResourceGrantService(db, clock),
    objects: new EventPlanningObjectService(db, clock),
  };
  cloudbase = {
    shares: new ResourceGrantService(db, clock, adapter),
    objects: new EventPlanningObjectService(db, clock, undefined, {
      permissionScope: adapter,
    }),
  };
});

afterAll(async () => {
  await harness?.database.close();
});

const context = (userId?: string) => mutationContext(harness, userId);

const backends = () =>
  [
    ["postgres", reference],
    ["cloudbase", cloudbase],
  ] as const;

async function sharingAudits(resourceId: string) {
  const rows = await harness.database.connection.db
    .select({ action: auditEvents.action, metadata: auditEvents.metadata })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.workspaceId, harness.workspaceId),
        eq(auditEvents.resourceId, resourceId),
        inArray(auditEvents.action, [
          "resource.shared",
          "resource.share_revoked",
          "resource.share_left",
        ]),
      ),
    )
    .orderBy(auditEvents.createdAt, auditEvents.action, auditEvents.id);
  return rows.map(({ action, metadata }) => {
    const { grantId, ...rest } = metadata as Record<string, unknown>;
    return {
      action,
      metadata: rest,
      grantIdPresent: typeof grantId === "string",
    };
  });
}

describe.sequential("CloudBase sharing writes", () => {
  it("shares, refreshes, and revokes with the same grants and audits", async () => {
    const results = [];
    for (const [, services] of backends()) {
      const event = await reference.objects.createEvent(context(), {
        displayName: "Shared",
      });
      const viewer = await services.shares.share(context(), {
        resourceId: event.id,
        principalEmail: granteeEmail,
        role: "viewer",
      });
      const editor = await services.shares.share(context(), {
        resourceId: event.id,
        principalEmail: granteeEmail,
        role: "editor",
      });
      expect(editor.id).toBe(viewer.id);
      const [stored] = await harness.database.connection.db
        .select()
        .from(resourceGrants)
        .where(eq(resourceGrants.id, viewer.id));
      const revoked = await services.shares.revoke(context(), viewer.id);
      const remaining = await harness.database.connection.db
        .select({ id: resourceGrants.id })
        .from(resourceGrants)
        .where(eq(resourceGrants.id, viewer.id));
      results.push({
        viewer: {
          role: viewer.role,
          grantedBy: viewer.grantedBy,
          expiresAt: viewer.expiresAt,
          principal: {
            ...viewer.principal,
            id: viewer.principal.id === granteeId,
          },
          resourceMatches: viewer.resourceId === event.id,
          workspaceMatches: viewer.workspaceId === harness.workspaceId,
          clock: viewer.createdAt instanceof Date,
        },
        editor: { role: editor.role, expiresAt: editor.expiresAt },
        stored: stored && { role: stored.role, expiresAt: stored.expiresAt },
        revoked: {
          idMatches: revoked.id === viewer.id,
          revokedAt: revoked.revokedAt,
        },
        remaining: remaining.length,
        audits: await sharingAudits(event.id),
      });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]).toMatchObject({
      viewer: {
        role: "viewer",
        grantedBy: harness.ownerId,
        expiresAt: null,
        principal: { id: true, displayName: "Grantee", email: granteeEmail },
      },
      editor: { role: "editor" },
      stored: { role: "editor" },
      revoked: { idMatches: true, revokedAt: clock() },
      remaining: 0,
    });
    expect(
      results[0]?.audits.map((entry) => [entry.action, entry.metadata]),
    ).toEqual([
      ["resource.shared", { principalId: granteeId, role: "viewer" }],
      ["resource.shared", { principalId: granteeId, role: "editor" }],
      ["resource.share_revoked", {}],
    ]);
  });

  it("shares with a person through the linked account, else the one account found by any email contact", async () => {
    const db = harness.database.connection.db;
    // A member with a linked person whose contacts name another account;
    // the grantee reachable by a person's second email contact; an
    // account that is not found by email; two accounts with one email;
    // and people with no account: unlinked without contacts, and in the
    // Trash.
    const memberId = createId();
    await db.insert(users).values({
      id: memberId,
      identityProvider: "test",
      providerSubject: memberId,
      displayName: "Member",
      email: "member@example.test",
    });
    await db.insert(workspaceMembers).values({
      workspaceId: harness.workspaceId,
      userId: memberId,
      role: "editor",
    });
    const hiddenId = createId();
    await db.insert(users).values({
      id: hiddenId,
      identityProvider: "test",
      providerSubject: hiddenId,
      displayName: "Hidden",
      email: "hidden@example.test",
      findByEmail: false,
    });
    for (const id of [createId(), createId()])
      await db.insert(users).values({
        id,
        identityProvider: "test",
        providerSubject: id,
        displayName: "Twin",
        email: "twins@example.test",
      });
    const person = (input: Record<string, unknown>) =>
      reference.objects.createPerson(context(), {
        displayName: "Someone",
        ...input,
      });
    const email = (value: string) => ({ kind: "email", value }) as const;
    const linked = await person({
      userId: memberId,
      contacts: [email(granteeEmail)],
    });
    const byContact = await person({
      contacts: [
        { kind: "phone", value: "+1 555 0100" },
        email("nobody@example.test"),
        email(granteeEmail.toUpperCase()),
      ],
    });
    const hidden = await person({ contacts: [email("hidden@example.test")] });
    const twins = await person({ contacts: [email("twins@example.test")] });
    const unreachable = await person({});
    const trashed = await person({ contacts: [email(granteeEmail)] });
    await reference.objects.softDelete(context(), trashed.id, trashed.version);
    const results = [];
    for (const [, services] of backends()) {
      const event = await reference.objects.createEvent(context(), {
        displayName: "With people",
      });
      const viaLink = await services.shares.share(context(), {
        resourceId: event.id,
        personId: linked.id,
        role: "editor",
      });
      const viaContact = await services.shares.share(context(), {
        resourceId: event.id,
        personId: byContact.id,
        role: "viewer",
      });
      const refused: string[] = [];
      for (const personId of [
        hidden.id,
        twins.id,
        unreachable.id,
        trashed.id,
        createId(),
      ])
        refused.push(
          (
            await failure(() =>
              services.shares.share(context(), {
                resourceId: event.id,
                personId,
                role: "viewer",
              }),
            )
          ).constructor.name,
        );
      refused.push(
        (
          await failure(() =>
            services.shares.share(context(), {
              resourceId: event.id,
              personId: linked.id,
              principalEmail: granteeEmail,
              role: "viewer",
            }),
          )
        ).message,
      );
      results.push({
        viaLink: {
          principalId: viaLink.principal.id === memberId,
          email: viaLink.principal.email,
          role: viaLink.role,
        },
        viaContact: {
          principalId: viaContact.principal.id === granteeId,
          email: viaContact.principal.email,
          role: viaContact.role,
        },
        refused,
        audits: await sharingAudits(event.id),
      });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]).toEqual({
      viaLink: {
        principalId: true,
        email: "member@example.test",
        role: "editor",
      },
      viaContact: { principalId: true, email: granteeEmail, role: "viewer" },
      refused: [
        PrincipalUnavailableError.name,
        PrincipalUnavailableError.name,
        PrincipalUnavailableError.name,
        PrincipalUnavailableError.name,
        PrincipalUnavailableError.name,
        "Name exactly one of principalEmail, personId, friendId, and principalId.",
      ],
      audits: [
        {
          action: "resource.shared",
          metadata: {
            principalId: memberId,
            role: "editor",
            personId: linked.id,
          },
          grantIdPresent: true,
        },
        {
          action: "resource.shared",
          metadata: {
            principalId: granteeId,
            role: "viewer",
            personId: byContact.id,
          },
          grantIdPresent: true,
        },
      ],
    });
  });

  it("shares with a friend through the caller's accepted connection", async () => {
    const db = harness.database.connection.db;
    // The owner's friend; a request still waiting; a friendship between two
    // other accounts.
    const account = async (name: string) => {
      const id = createId();
      await db.insert(users).values({
        id,
        identityProvider: "test",
        providerSubject: id,
        displayName: name,
        email: `${id}@example.test`,
      });
      return id;
    };
    const friendId = await account("Friend");
    const waitingId = await account("Waiting");
    const strangerA = await account("Stranger A");
    const strangerB = await account("Stranger B");
    const connection = async (
      requesterId: string,
      addresseeId: string,
      status: "accepted" | "pending",
    ) => {
      const id = createId();
      await db.insert(userConnections).values({
        id,
        requesterId,
        addresseeId,
        status,
      });
      return id;
    };
    const accepted = await connection(friendId, harness.ownerId, "accepted");
    const waiting = await connection(harness.ownerId, waitingId, "pending");
    const foreign = await connection(strangerA, strangerB, "accepted");
    const results = [];
    for (const [, services] of backends()) {
      const event = await reference.objects.createEvent(context(), {
        displayName: "With a friend",
      });
      const shared = await services.shares.share(context(), {
        resourceId: event.id,
        friendId: accepted,
        role: "editor",
      });
      const refused: string[] = [];
      for (const friend of [waiting, foreign, createId()])
        refused.push(
          (
            await failure(() =>
              services.shares.share(context(), {
                resourceId: event.id,
                friendId: friend,
                role: "viewer",
              }),
            )
          ).constructor.name,
        );
      results.push({
        principalId: shared.principal.id === friendId,
        displayName: shared.principal.displayName,
        role: shared.role,
        refused,
        audits: await sharingAudits(event.id),
      });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]).toEqual({
      principalId: true,
      displayName: "Friend",
      role: "editor",
      refused: [
        PrincipalUnavailableError.name,
        PrincipalUnavailableError.name,
        PrincipalUnavailableError.name,
      ],
      audits: [
        {
          action: "resource.shared",
          metadata: {
            principalId: friendId,
            role: "editor",
            friendId: accepted,
          },
          grantIdPresent: true,
        },
      ],
    });
  });

  it("lets the grantee leave with the same grants gone and the same audit", async () => {
    const results = [];
    for (const [, services] of backends()) {
      const event = await reference.objects.createEvent(context(), {
        displayName: "Left",
      });
      const whole = await services.shares.share(context(), {
        resourceId: event.id,
        principalEmail: granteeEmail,
        role: "viewer",
      });
      const todos = await services.shares.share(context(), {
        resourceId: event.id,
        principalEmail: granteeEmail,
        role: "editor",
        scope: { view: "todos", sectionId: null },
      });
      // The owner holds no grant to give up; a stranger neither.
      const refused = [
        await failure(() => services.shares.leave(context(), event.id)),
        await failure(() =>
          services.shares.leave(context(harness.viewerId), event.id),
        ),
      ].map((error) => error.constructor.name);
      const left = await services.shares.leave(context(granteeId), event.id);
      const remaining = await harness.database.connection.db
        .select({ id: resourceGrants.id })
        .from(resourceGrants)
        .where(eq(resourceGrants.resourceId, event.id));
      const again = (
        await failure(() => services.shares.leave(context(granteeId), event.id))
      ).constructor.name;
      const expected = [whole.id, todos.id].sort();
      const sameGrants = (ids: unknown) =>
        Array.isArray(ids) && [...ids].sort().join() === expected.join();
      results.push({
        refused,
        left: {
          resourceMatches: left.resourceId === event.id,
          grantsMatch: sameGrants(left.grantIds),
          leftAt: left.leftAt,
        },
        remaining: remaining.length,
        again,
        audits: (await sharingAudits(event.id)).map((entry) => [
          entry.action,
          entry.action === "resource.share_left"
            ? { grantsMatch: sameGrants(entry.metadata.grantIds) }
            : entry.metadata,
        ]),
      });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]).toEqual({
      refused: [AuthorizationDeniedError.name, AuthorizationDeniedError.name],
      left: { resourceMatches: true, grantsMatch: true, leftAt: clock() },
      remaining: 0,
      again: AuthorizationDeniedError.name,
      audits: [
        ["resource.shared", { principalId: granteeId, role: "viewer" }],
        [
          "resource.shared",
          {
            principalId: granteeId,
            role: "editor",
            scope: { view: "todos", sectionId: null },
          },
        ],
        ["resource.share_left", { grantsMatch: true }],
      ],
    });
  });

  it("refuses the same shares and revocations with the same errors", async () => {
    const outcomes = [];
    for (const [, services] of backends()) {
      const event = await reference.objects.createEvent(context(), {
        displayName: "Guarded",
      });
      const seen: string[] = [];
      const record = (error: Error) =>
        seen.push(`${error.constructor.name}: ${error.message}`);
      record(
        await failure(() =>
          services.shares.share(context(), {
            resourceId: event.id,
            principalEmail: "nobody@example.test",
            role: "viewer",
          }),
        ),
      );
      record(
        await failure(() =>
          services.shares.share(context(harness.viewerId), {
            resourceId: event.id,
            principalEmail: granteeEmail,
            role: "viewer",
          }),
        ),
      );
      record(
        await failure(() =>
          services.shares.share(context(), {
            resourceId: createId(),
            principalEmail: granteeEmail,
            role: "viewer",
          }),
        ),
      );
      await harness.database.connection.db
        .update(users)
        .set({ email: "owner@example.test" })
        .where(eq(users.id, harness.ownerId));
      record(
        await failure(() =>
          services.shares.share(context(), {
            resourceId: event.id,
            principalEmail: "owner@example.test",
            role: "viewer",
          }),
        ),
      );
      const grant = await services.shares.share(context(), {
        resourceId: event.id,
        principalEmail: granteeEmail,
        role: "viewer",
      });
      record(
        await failure(() =>
          services.shares.revoke(context(granteeId), grant.id),
        ),
      );
      record(
        await failure(() => services.shares.revoke(context(), createId())),
      );
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toEqual([
      `${PrincipalUnavailableError.name}: ${new PrincipalUnavailableError().message}`,
      `${AuthorizationDeniedError.name}: ${new AuthorizationDeniedError().message}`,
      `${AuthorizationDeniedError.name}: ${new AuthorizationDeniedError().message}`,
      `${InvalidShareError.name}: A resource cannot be shared with the acting user.`,
      `${AuthorizationDeniedError.name}: ${new AuthorizationDeniedError().message}`,
      `${AuthorizationDeniedError.name}: ${new AuthorizationDeniedError().message}`,
    ]);
  });

  it("changes the permission scope with the same resource, revision, and errors", async () => {
    const results = [];
    for (const [, services] of backends()) {
      const parent = await reference.objects.createEvent(context(), {
        displayName: "Parent",
      });
      const other = await reference.objects.createEvent(context(), {
        displayName: "Other",
      });
      const child = await reference.objects.createTask(context(), {
        displayName: "Child",
        permissionScopeId: parent.id,
      });
      const seen: string[] = [];
      const record = (error: Error) =>
        seen.push(`${error.constructor.name}: ${error.message}`);

      record(
        await failure(() =>
          services.objects.updatePermissionScope(context(), child.id, {
            expectedVersion: 2,
            permissionScopeId: other.id,
          }),
        ),
      );
      record(
        await failure(() =>
          services.objects.updatePermissionScope(context(), child.id, {
            expectedVersion: 1,
            permissionScopeId: parent.id,
          }),
        ),
      );
      record(
        await failure(() =>
          services.objects.updatePermissionScope(context(), child.id, {
            expectedVersion: 1,
            permissionScopeId: createId(),
          }),
        ),
      );
      const otherTask = await reference.objects.createTask(context(), {
        displayName: "Not a scope",
      });
      record(
        await failure(() =>
          services.objects.updatePermissionScope(context(), child.id, {
            expectedVersion: 1,
            permissionScopeId: otherTask.id,
          }),
        ),
      );
      record(
        await failure(() =>
          services.objects.updatePermissionScope(
            context(harness.viewerId),
            child.id,
            {
              expectedVersion: 1,
              permissionScopeId: other.id,
            },
          ),
        ),
      );

      const detached = await services.objects.updatePermissionScope(
        context(),
        child.id,
        { expectedVersion: 1, permissionScopeId: child.id },
      );
      const moved = await services.objects.updatePermissionScope(
        context(),
        child.id,
        { expectedVersion: 2, permissionScopeId: other.id },
      );
      results.push({
        errors: seen,
        detached: {
          ...shape(detached),
          scopeIsSelf: detached.permissionScopeId === detached.id,
        },
        moved: {
          ...shape(moved),
          scopeIsOther: moved.permissionScopeId === other.id,
        },
        ledger: (await ledger(harness, child.id)).map((entry) => ({
          ...entry,
          metadata: Object.fromEntries(
            Object.entries(entry.metadata).map(([key, value]) => [
              key,
              value === parent.id
                ? "<parent>"
                : value === other.id
                  ? "<other>"
                  : value === child.id
                    ? "<child>"
                    : value,
            ]),
          ),
        })),
      });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]?.errors).toEqual([
      `${ObjectConflictError.name}: ${new ObjectConflictError().message}`,
      `${InvalidObjectStateError.name}: permissionScopeId must change the current permission scope.`,
      `${AuthorizationDeniedError.name}: ${new AuthorizationDeniedError().message}`,
      `${InvalidObjectStateError.name}: permissionScopeId must reference a self-scoped Event.`,
      `${AuthorizationDeniedError.name}: ${new AuthorizationDeniedError().message}`,
    ]);
    expect(results[0]?.detached).toMatchObject({
      version: 2,
      scopeIsSelf: true,
    });
    expect(results[0]?.moved).toMatchObject({ version: 3, scopeIsOther: true });
    expect(
      results[0]?.ledger.map((entry) => [entry.action, entry.metadata]),
    ).toEqual([
      ["task.created", { version: 1 }],
      // The ledger helper reports the audit's permissionScopeId separately.
      [
        "object.permission_scope_updated",
        {
          previousPermissionScopeId: "<parent>",
          previousVersion: 1,
          version: 2,
        },
      ],
      [
        "object.permission_scope_updated",
        {
          previousPermissionScopeId: "<child>",
          previousVersion: 2,
          version: 3,
        },
      ],
    ]);
  });
});
