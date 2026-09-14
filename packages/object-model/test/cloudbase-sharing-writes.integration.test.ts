import {
  AuthorizationDeniedError,
  InvalidShareError,
  PrincipalUnavailableError,
  ResourceGrantService,
} from "@chronelle/authorization";
import { auditEvents, createId, resourceGrants, users } from "@chronelle/db";
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

// chronelle_resource_share, chronelle_resource_share_revoke, and
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
        ]),
      ),
    )
    .orderBy(auditEvents.id);
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
