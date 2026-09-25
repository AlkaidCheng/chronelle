import { resolve } from "node:path";
import {
  auditEvents,
  createId,
  objectRevisions,
  objects,
  resourceGrants,
  type DatabaseTransaction,
} from "@livtales/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import { withStableAuthorization } from "@livtales/authorization";
import { EventPlanningObjectService } from "@livtales/object-model";
import {
  developmentSignInResponseSchema,
  eventPlanningResourceResponseSchema,
  revisionRestorePreviewSchema,
  revisionComparisonResponseSchema,
} from "@livtales/schemas";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDevelopmentAppDependencies } from "../src/dependencies.js";

let database: TestDatabase;
let app: FastifyInstance;
beforeEach(async () => {
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
  app = buildApp(createDevelopmentAppDependencies(database.connection));
});
afterEach(async () => {
  await app?.close();
  await database?.close();
});

async function signIn(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/development/sign-in",
    payload: { email, displayName: "Planner" },
  });
  return developmentSignInResponseSchema.parse(response.json());
}
type Session = Awaited<ReturnType<typeof signIn>>;
const headers = (session: Session, workspaceId = session.workspace.id) => ({
  authorization: `Bearer ${session.accessToken}`,
  "x-workspace-id": workspaceId,
});
async function create(
  session: Session,
  collection: string,
  payload: Record<string, unknown>,
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/${collection}`,
    headers: headers(session),
    payload,
  });
  expect(response.statusCode).toBe(201);
  return eventPlanningResourceResponseSchema.parse(response.json());
}
async function update(
  session: Session,
  collection: string,
  id: string,
  payload: Record<string, unknown>,
) {
  const response = await app.inject({
    method: "PATCH",
    url: `/api/${collection}/${id}`,
    headers: headers(session),
    payload: { expectedVersion: 1, ...payload },
  });
  expect(response.statusCode).toBe(200);
  return eventPlanningResourceResponseSchema.parse(response.json());
}
function restore(
  session: Session,
  id: string,
  expectedVersion = 2,
  workspaceId = session.workspace.id,
) {
  return app.inject({
    method: "POST",
    url: `/api/objects/${id}/revisions/1/restore`,
    headers: headers(session, workspaceId),
    payload: { expectedVersion },
  });
}
async function waitForWorkspaceLock(table = "workspaces") {
  await expect
    .poll(
      async () => {
        const [row] = await database.connection.sql<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND query ILIKE ${`%${table}%`}
    `;
        return row?.count ?? 0;
      },
      { timeout: 3000 },
    )
    .toBeGreaterThan(0);
}

describe.sequential("content restoration", () => {
  it("rejects restoration provenance from another canonical object", async () => {
    const owner = await signIn("owner@example.com");
    const first = await create(owner, "tasks", { displayName: "First" });
    const second = await create(owner, "tasks", { displayName: "Second" });
    const [original] = await database.connection.db
      .select()
      .from(objectRevisions)
      .where(eq(objectRevisions.objectId, first.id));
    const [foreign] = await database.connection.db
      .select()
      .from(objectRevisions)
      .where(eq(objectRevisions.objectId, second.id));
    if (original === undefined || foreign === undefined)
      throw new Error("Missing fixture revisions.");
    await expect(
      database.connection.db.transaction(async (transaction) => {
        await transaction
          .update(objects)
          .set({ version: 2 })
          .where(eq(objects.id, first.id));
        const auditId = createId();
        await transaction.insert(auditEvents).values({
          id: auditId,
          workspaceId: owner.workspace.id,
          actorType: "user",
          actorId: owner.user.id,
          resourceId: first.id,
          action: "task.restored",
          requestId: original.requestId,
          metadata: { sourceRevisionId: foreign.id },
        });
        await transaction.insert(objectRevisions).values({
          ...original,
          id: createId(),
          objectVersion: 2,
          mutationKind: "restored",
          sourceRevisionId: foreign.id,
          auditEventId: auditId,
          snapshot: { ...original.snapshot, version: 2 },
        });
      }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    const [unchanged] = await database.connection.db
      .select()
      .from(objects)
      .where(eq(objects.id, first.id));
    expect(unchanged?.version).toBe(1);
  });

  it("fails closed for unsupported historical snapshot schemas", async () => {
    const owner = await signIn("owner@example.com");
    const task = await create(owner, "tasks", { displayName: "Original" });
    const [original] = await database.connection.db
      .select()
      .from(objectRevisions)
      .where(eq(objectRevisions.objectId, task.id));
    if (original === undefined) throw new Error("Missing fixture revision.");
    await database.connection.db.transaction(async (transaction) => {
      await transaction
        .update(objects)
        .set({ version: 2 })
        .where(eq(objects.id, task.id));
      const auditId = createId();
      await transaction.insert(auditEvents).values({
        id: auditId,
        workspaceId: owner.workspace.id,
        actorType: "user",
        actorId: owner.user.id,
        resourceId: task.id,
        action: "task.updated",
        requestId: original.requestId,
        metadata: {},
      });
      await transaction.insert(objectRevisions).values({
        ...original,
        id: createId(),
        objectVersion: 2,
        mutationKind: "updated",
        auditEventId: auditId,
        snapshotSchemaVersion: 2,
        snapshot: { ...original.snapshot, version: 2 },
      });
    });
    for (const suffix of [
      "2/restore-preview",
      "compare?fromVersion=1&toVersion=2",
    ]) {
      expect(
        (
          await app.inject({
            url: `/api/objects/${task.id}/revisions/${suffix}`,
            headers: headers(owner),
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/objects/${task.id}/revisions/2/restore`,
          headers: headers(owner),
          payload: { expectedVersion: 2 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      await database.connection
        .sql`SELECT id FROM audit_events WHERE action = 'task.restored'`,
    ).toHaveLength(0);
  });
  it("commits a winning restore before a concurrent grant revocation", async () => {
    const owner = await signIn("owner@example.com");
    const editor = await signIn("editor@example.com");
    const event = await create(owner, "events", { displayName: "Original" });
    await update(owner, "events", event.id, { displayName: "Current" });
    const share = await app.inject({
      method: "POST",
      url: "/api/shares",
      headers: headers(owner),
      payload: {
        resourceId: event.id,
        principalEmail: "editor@example.com",
        role: "editor",
      },
    });
    const held = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const barrier = database.connection.sql.begin(async (transaction) => {
      await transaction`LOCK TABLE audit_events IN SHARE MODE`;
      held.resolve();
      await release.promise;
    });
    await held.promise;
    const restoring = restore(editor, event.id, 2, owner.workspace.id).then(
      (response) => response,
    );
    let revoking: Promise<unknown> | undefined;
    try {
      await waitForWorkspaceLock("audit_events");
      revoking = app
        .inject({
          method: "DELETE",
          url: `/api/shares/${share.json().id}`,
          headers: headers(owner),
        })
        .then((response) => {
          expect(response.statusCode).toBe(200);
        });
      await waitForWorkspaceLock();
    } finally {
      release.resolve();
    }
    await barrier;
    expect((await restoring).statusCode).toBe(200);
    await revoking;
    expect(
      (await restore(editor, event.id, 3, owner.workspace.id)).statusCode,
    ).toBe(404);
  });

  it("allows only one restore to consume the same current version", async () => {
    const owner = await signIn("owner@example.com");
    const task = await create(owner, "tasks", { displayName: "Original" });
    await update(owner, "tasks", task.id, { displayName: "Current" });
    const responses = await Promise.all([
      restore(owner, task.id),
      restore(owner, task.id),
      restore(owner, task.id),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 409, 409,
    ]);
    expect(
      await database.connection
        .sql`SELECT id FROM audit_events WHERE action = 'task.restored'`,
    ).toHaveLength(1);
  });
  it("restores the same canonical Event forward with audit provenance and refreshed projections", async () => {
    const owner = await signIn("owner@example.com");
    const event = await create(owner, "events", { displayName: "Conference" });
    const child = await create(owner, "events", {
      displayName: "Opening",
      permissionScopeId: event.id,
      startsAt: "2026-10-01T10:00:00Z",
      endsAt: "2026-10-01T11:00:00Z",
      timezone: "UTC",
      customProperties: { room: "A" },
    });
    await app.inject({
      method: "POST",
      url: `/api/objects/${event.id}/relations`,
      headers: headers(owner),
      payload: { relationType: "includes", targetObjectId: child.id },
    });
    await update(owner, "events", child.id, {
      displayName: "Opening revised",
      startsAt: "2026-10-01T12:00:00Z",
      endsAt: "2026-10-01T13:00:00Z",
      customProperties: { room: "B" },
      metadata: { internal: "current" },
    });
    const preview = await app.inject({
      url: `/api/objects/${child.id}/revisions/1/restore-preview`,
      headers: headers(owner),
    });
    const proposal = revisionRestorePreviewSchema.parse(preview.json());
    expect(proposal).toMatchObject({ currentVersion: 2, canRestore: true });
    expect(proposal.changes.map((field) => field.label)).toEqual([
      "Name",
      "Starts",
      "Ends",
      "Custom property: room",
    ]);
    const restored = eventPlanningResourceResponseSchema.parse(
      (await restore(owner, child.id)).json(),
    );
    expect(restored).toMatchObject({
      id: child.id,
      displayName: "Opening",
      version: 3,
      permissionScopeId: event.id,
      metadata: { internal: "current" },
      createdAt: child.createdAt,
    });
    for (const projection of ["calendar", "itinerary", "timeline"]) {
      const response = await app.inject({
        url: `/api/events/${event.id}/${projection}`,
        headers: headers(owner),
      });
      expect(response.json().items[0]).toMatchObject({
        displayName: "Opening",
        version: 3,
      });
    }
    const revisions = await database.connection.db
      .select()
      .from(objectRevisions)
      .where(eq(objectRevisions.objectId, child.id));
    expect(revisions).toHaveLength(3);
    const restoredRevision = revisions.find((row) => row.objectVersion === 3);
    expect(restoredRevision).toMatchObject({
      mutationKind: "restored",
      sourceRevisionId: proposal.sourceRevisionId,
    });
    if (restoredRevision === undefined)
      throw new Error("The restore revision is missing.");
    const audit = await database.connection
      .sql`SELECT action, metadata FROM audit_events WHERE id = ${restoredRevision.auditEventId}`;
    expect(audit[0]).toMatchObject({
      action: "event.restored",
      metadata: {
        sourceRevisionId: proposal.sourceRevisionId,
        sourceVersion: 1,
        previousVersion: 2,
        version: 3,
      },
    });
    const comparison = await app.inject({
      url: `/api/objects/${child.id}/revisions/compare?fromVersion=1&toVersion=2`,
      headers: headers(owner),
    });
    expect(
      revisionComparisonResponseSchema.parse(comparison.json()).changes,
    ).toHaveLength(4);
    expect(comparison.body).not.toContain("internal");
    expect((await restore(owner, child.id)).statusCode).toBe(409);
    expect((await restore(owner, child.id, 3)).statusCode).toBe(400);
  });

  it("preserves financial and delivery facts while restoring eligible content", async () => {
    const owner = await signIn("owner@example.com");
    const expense = await create(owner, "expenses", {
      displayName: "Deposit",
      amount: "10",
      currency: "USD",
      occurredAt: "2026-09-01T12:00:00Z",
    });
    await update(owner, "expenses", expense.id, {
      displayName: "Deposit corrected",
      amount: "20",
      currency: "EUR",
      occurredAt: "2026-09-02T12:00:00Z",
    });
    const restored = eventPlanningResourceResponseSchema.parse(
      (await restore(owner, expense.id)).json(),
    );
    expect(restored).toMatchObject({
      displayName: "Deposit",
      amount: "20.0000",
      currency: "EUR",
      occurredAt: "2026-09-02T12:00:00.000Z",
    });
    const reminder = await create(owner, "reminders", {
      displayName: "Notify",
      remindAt: "2026-10-01T12:00:00Z",
    });
    await update(owner, "reminders", reminder.id, {
      remindAt: "2026-10-02T12:00:00Z",
      status: "triggered",
    });
    expect(
      eventPlanningResourceResponseSchema.parse(
        (await restore(owner, reminder.id)).json(),
      ),
    ).toMatchObject({
      remindAt: "2026-10-01T12:00:00.000Z",
      status: "triggered",
    });
    const task = await create(owner, "tasks", { displayName: "Confirm" });
    await update(owner, "tasks", task.id, {
      status: "done",
      completedAt: "2026-09-02T12:00:00Z",
    });
    expect(
      eventPlanningResourceResponseSchema.parse(
        (await restore(owner, task.id)).json(),
      ),
    ).toMatchObject({ status: "todo", completedAt: null, version: 3 });
  });

  it("authorizes comparisons and restore independently and rejects injected fields", async () => {
    const owner = await signIn("owner@example.com");
    const viewer = await signIn("viewer@example.com");
    const stranger = await signIn("stranger@example.com");
    const event = await create(owner, "events", { displayName: "Original" });
    await update(owner, "events", event.id, { displayName: "Current" });
    await app.inject({
      method: "POST",
      url: "/api/shares",
      headers: headers(owner),
      payload: {
        resourceId: event.id,
        principalEmail: "viewer@example.com",
        role: "viewer",
      },
    });
    const path = `/api/objects/${event.id}/revisions`;
    expect(
      (
        await app.inject({
          url: `${path}/compare?fromVersion=1&toVersion=2`,
          headers: headers(viewer, owner.workspace.id),
        })
      ).statusCode,
    ).toBe(200);
    const preview = await app.inject({
      url: `${path}/1/restore-preview`,
      headers: headers(viewer, owner.workspace.id),
    });
    expect(revisionRestorePreviewSchema.parse(preview.json()).canRestore).toBe(
      false,
    );
    expect(
      (await restore(viewer, event.id, 2, owner.workspace.id)).statusCode,
    ).toBe(404);
    expect((await restore(stranger, event.id)).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          url: `${path}/compare?fromVersion=1&toVersion=2`,
          headers: headers(stranger),
        })
      ).statusCode,
    ).toBe(404);
    for (const injected of [
      { permissionScopeId: createId() },
      { metadata: { elevated: true } },
      { deletedAt: null },
      { content: { displayName: "Injected" } },
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `${path}/1/restore`,
            headers: headers(owner),
            payload: { expectedVersion: 2, ...injected },
          })
        ).statusCode,
      ).toBe(400);
    }
    await app.inject({
      method: "DELETE",
      url: `/api/objects/${event.id}?expectedVersion=2`,
      headers: headers(owner),
    });
    expect((await restore(owner, event.id, 3)).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          url: `${path}/1/restore-preview`,
          headers: headers(owner),
        })
      ).statusCode,
    ).toBe(404);
  });

  it("rolls back the complete restoration when revision persistence fails", async () => {
    const owner = await signIn("owner@example.com");
    const task = await create(owner, "tasks", { displayName: "Original" });
    await update(owner, "tasks", task.id, { displayName: "Current" });
    await database.connection.sql
      .unsafe(`CREATE FUNCTION reject_restore() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.mutation_kind = 'restored' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER reject_restore BEFORE INSERT ON object_revisions FOR EACH ROW EXECUTE FUNCTION reject_restore();`);
    expect((await restore(owner, task.id)).statusCode).toBe(500);
    const [current] = await database.connection.db
      .select()
      .from(objects)
      .where(eq(objects.id, task.id));
    expect(current).toMatchObject({ version: 2, displayName: "Current" });
    expect(
      await database.connection.db
        .select()
        .from(objectRevisions)
        .where(eq(objectRevisions.objectId, task.id)),
    ).toHaveLength(2);
    const audits = await database.connection
      .sql`SELECT id FROM audit_events WHERE action = 'task.restored'`;
    expect(audits).toHaveLength(0);
  });

  it.each(["revocation", "scope change"])(
    "rechecks permission after a concurrent %s wins the workspace lock",
    async (operation) => {
      const owner = await signIn("owner@example.com");
      const editor = await signIn("editor@example.com");
      const event = await create(owner, "events", { displayName: "Context" });
      const task = await create(owner, "tasks", {
        displayName: "Original",
        permissionScopeId: event.id,
      });
      await update(owner, "tasks", task.id, { displayName: "Current" });
      await app.inject({
        method: "POST",
        url: "/api/shares",
        headers: headers(owner),
        payload: {
          resourceId: event.id,
          principalEmail: "editor@example.com",
          role: "editor",
        },
      });
      const held = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const writer = withStableAuthorization(
        database.connection.db,
        owner.workspace.id,
        async (transaction: DatabaseTransaction, authorization) => {
          if (operation === "revocation") {
            await transaction
              .delete(resourceGrants)
              .where(eq(resourceGrants.resourceId, event.id));
          } else {
            await new EventPlanningObjectService({
              database: transaction,
              authorization,
            }).updatePermissionScope(
              {
                principal: {
                  type: "user",
                  userId: owner.user.id,
                  workspaceId: owner.workspace.id,
                },
                requestId: createId(),
              },
              task.id,
              { expectedVersion: 2, permissionScopeId: task.id },
            );
          }
          held.resolve();
          await release.promise;
        },
      );
      await held.promise;
      const pending = restore(editor, task.id, 2, owner.workspace.id).then(
        (response) => response,
      );
      try {
        await waitForWorkspaceLock();
      } finally {
        release.resolve();
      }
      await writer;
      expect((await pending).statusCode).toBe(404);
      expect(
        await database.connection
          .sql`SELECT id FROM audit_events WHERE action = 'task.restored'`,
      ).toHaveLength(0);
    },
  );
});
