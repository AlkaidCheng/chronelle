import { resolve } from "node:path";

import { createId, events, objectRevisions, objects } from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  assertRevisionBaseline,
  baselineObjectRevisions,
} from "@chronelle/object-model";
import {
  developmentSignInResponseSchema,
  eventPlanningResourceResponseSchema,
  revisionListResponseSchema,
  revisionResponseSchema,
} from "@chronelle/schemas";
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
function headers(
  session: Awaited<ReturnType<typeof signIn>>,
  workspaceId = session.workspace.id,
) {
  return {
    authorization: `Bearer ${session.accessToken}`,
    "x-workspace-id": workspaceId,
  };
}
async function create(
  session: Awaited<ReturnType<typeof signIn>>,
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

describe.sequential("object revisions", () => {
  it("captures complete typed versions with matching audits and stable keyset pages", async () => {
    const owner = await signIn("owner@example.com");
    const fixtures = [
      {
        collection: "events",
        fields: { startsAt: "2026-10-01T12:00:00Z", timezone: "UTC" },
        patch: { endsAt: "2026-10-01T13:00:00Z" },
      },
      {
        collection: "tasks",
        fields: { dueAt: "2026-09-30T12:00:00Z" },
        patch: { status: "in_progress" },
      },
      {
        collection: "expenses",
        fields: {
          amount: "999999999999999.1234",
          currency: "USD",
          occurredAt: "2026-09-01T12:00:00Z",
        },
        patch: { amount: "25.5000" },
      },
      {
        collection: "reminders",
        fields: { remindAt: "2026-09-30T12:00:00Z" },
        patch: { status: "dismissed" },
      },
    ];
    for (const fixture of fixtures) {
      const object = await create(owner, fixture.collection, {
        displayName: fixture.collection,
        customProperties: { notes: "Keep the original" },
        metadata: { internal: "hidden" },
        ...fixture.fields,
      });
      const update = await app.inject({
        method: "PATCH",
        url: `/api/${fixture.collection}/${object.id}`,
        headers: headers(owner),
        payload: { expectedVersion: 1, ...fixture.patch },
      });
      expect(update.statusCode).toBe(200);
      const state = eventPlanningResourceResponseSchema.parse(update.json());
      const history = await app.inject({
        method: "GET",
        url: `/api/objects/${object.id}/revisions?limit=1`,
        headers: headers(owner),
      });
      const page = revisionListResponseSchema.parse(history.json());
      expect(page).toMatchObject({
        items: [
          {
            objectVersion: 2,
            mutationKind: "updated",
            actorId: owner.user.id,
            changedFieldCount: 1,
            changedFields: [
              { field: Object.keys(fixture.patch)[0], beforePresent: true },
            ],
          },
        ],
        nextBeforeVersion: 2,
      });
      expect(history.json().items[0]).not.toHaveProperty("snapshot");
      const detail = await app.inject({
        method: "GET",
        url: `/api/objects/${object.id}/revisions/1`,
        headers: headers(owner),
      });
      const first = revisionResponseSchema.parse(detail.json());
      expect(first.snapshot).toMatchObject({
        id: object.id,
        version: 1,
        displayName: fixture.collection,
        customProperties: { notes: "Keep the original" },
      });
      expect(first.snapshot).not.toHaveProperty("metadata");
      expect(first.snapshot).not.toHaveProperty("permissionScopeId");
      if (first.snapshot.objectType === "expense")
        expect(first.snapshot.amount).toBe("999999999999999.1234");
      const rows = await database.connection.db
        .select()
        .from(objectRevisions)
        .where(eq(objectRevisions.objectId, object.id));
      expect(rows.find((row) => row.objectVersion === 2)?.snapshot).toEqual(
        state,
      );
      const concurrent = await Promise.all(
        ["First writer", "Second writer"].map((displayName) =>
          app.inject({
            method: "PATCH",
            url: `/api/${fixture.collection}/${object.id}`,
            headers: headers(owner),
            payload: { expectedVersion: 2, displayName },
          }),
        ),
      );
      expect(concurrent.map((response) => response.statusCode).sort()).toEqual([
        200, 409,
      ]);
      const winner = concurrent
        .find((response) => response.statusCode === 200)
        ?.json();
      const last = await app.inject({
        method: "GET",
        url: `/api/objects/${object.id}/revisions/3`,
        headers: headers(owner),
      });
      expect(last.json().snapshot).toMatchObject({
        displayName: winner.displayName,
        version: 3,
      });
      const older = await app.inject({
        method: "GET",
        url: `/api/objects/${object.id}/revisions?beforeVersion=2&limit=1`,
        headers: headers(owner),
      });
      expect(older.json()).toMatchObject({
        items: [{ objectVersion: 1 }],
        nextBeforeVersion: null,
      });
    }
    const correlations = await database.connection.sql`
      SELECT r.object_version, r.request_id, r.actor_id, r.object_id,
        a.request_id AS audit_request, a.actor_id AS audit_actor,
        a.resource_id AS audit_resource, a.metadata->>'version' AS audit_version
      FROM object_revisions r JOIN audit_events a ON a.id = r.audit_event_id
    `;
    expect(correlations).toHaveLength(12);
    for (const row of correlations) {
      expect(row.request_id).toBe(row.audit_request);
      expect(row.actor_id).toBe(row.audit_actor);
      expect(row.object_id).toBe(row.audit_resource);
      expect(row.object_version).toBe(Number(row.audit_version));
    }
  });

  it("uses current authorization for earlier values and never reveals unavailable history", async () => {
    const owner = await signIn("owner@example.com");
    const viewer = await signIn("viewer@example.com");
    const unrelated = await signIn("unrelated@example.com");
    const event = await create(owner, "events", {
      displayName: "Shared Event",
    });
    const task = await create(owner, "tasks", {
      displayName: "Earlier value",
      permissionScopeId: event.id,
    });
    const share = await app.inject({
      method: "POST",
      url: "/api/shares",
      headers: headers(owner),
      payload: {
        resourceId: event.id,
        principalEmail: "viewer@example.com",
        role: "viewer",
      },
    });
    expect(share.statusCode).toBe(201);
    for (const suffix of ["", "/1"]) {
      const visible = await app.inject({
        method: "GET",
        url: `/api/objects/${task.id}/revisions${suffix}`,
        headers: headers(viewer, owner.workspace.id),
      });
      expect(visible.statusCode).toBe(200);
      // The request follows the object's workspace, so the viewer and the
      // owner reach it from any workspace header; an unrelated account
      // never does.
      for (const credential of [
        headers(viewer),
        headers(owner, viewer.workspace.id),
      ]) {
        expect(
          (
            await app.inject({
              method: "GET",
              url: `/api/objects/${task.id}/revisions${suffix}`,
              headers: credential,
            })
          ).statusCode,
        ).toBe(200);
      }
      for (const credential of [headers(unrelated, owner.workspace.id)]) {
        const denied = await app.inject({
          method: "GET",
          url: `/api/objects/${task.id}/revisions${suffix}`,
          headers: credential,
        });
        expect(denied.statusCode).toBe(404);
        const missing = await app.inject({
          method: "GET",
          url: `/api/objects/${createId()}/revisions${suffix}`,
          headers: credential,
        });
        expect(denied.json()).toEqual(missing.json());
      }
    }
    const edit = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: headers(viewer, owner.workspace.id),
      payload: { expectedVersion: 1, displayName: "Denied edit" },
    });
    expect(edit.statusCode).toBe(404);
    const stopInheritance = await app.inject({
      method: "PATCH",
      url: `/api/objects/${task.id}/permission-scope`,
      headers: headers(owner),
      payload: { expectedVersion: 1, permissionScopeId: task.id },
    });
    expect(stopInheritance.statusCode).toBe(200);
    const scopeRevision = await app.inject({
      method: "GET",
      url: `/api/objects/${task.id}/revisions/2`,
      headers: headers(owner),
    });
    expect(scopeRevision.json()).toMatchObject({
      mutationKind: "permission_scope_updated",
    });
    const hidden = await app.inject({
      method: "GET",
      url: `/api/objects/${task.id}/revisions`,
      headers: headers(viewer, owner.workspace.id),
    });
    expect(hidden.statusCode).toBe(404);
    const revoke = await app.inject({
      method: "DELETE",
      url: `/api/shares/${share.json().id}`,
      headers: headers(owner),
    });
    expect(revoke.statusCode).toBe(200);
    const revoked = await app.inject({
      method: "GET",
      url: `/api/objects/${event.id}/revisions`,
      headers: headers(viewer, owner.workspace.id),
    });
    expect(revoked.statusCode).toBe(404);
    const deletion = await app.inject({
      method: "DELETE",
      url: `/api/objects/${task.id}?expectedVersion=2`,
      headers: headers(owner),
    });
    expect(deletion.statusCode).toBe(200);
    const [tombstone] = await database.connection.db
      .select()
      .from(objectRevisions)
      .where(eq(objectRevisions.objectVersion, 3));
    expect(tombstone?.snapshot.deletedAt).toBe(deletion.json().deletedAt);
    const deletedHistory = await app.inject({
      method: "GET",
      url: `/api/objects/${task.id}/revisions`,
      headers: headers(owner),
    });
    expect(deletedHistory.statusCode).toBe(404);
    const invalidPage = await app.inject({
      method: "GET",
      url: `/api/objects/${event.id}/revisions?limit=101`,
      headers: headers(owner),
    });
    expect(invalidPage.statusCode).toBe(400);
  });

  it("rejects revision changes and rolls back live state and audit on snapshot failure", async () => {
    const owner = await signIn("owner@example.com");
    const event = await create(owner, "events", { displayName: "Original" });
    for (const query of [
      "UPDATE object_revisions SET mutation_kind = 'baseline'",
      "DELETE FROM object_revisions",
      "TRUNCATE object_revisions CASCADE",
    ])
      await expect(database.connection.sql.unsafe(query)).rejects.toMatchObject(
        { code: "55000" },
      );
    await database.connection.sql.unsafe(`
      CREATE FUNCTION reject_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'snapshot storage unavailable'; END; $$;
      CREATE TRIGGER reject_snapshot BEFORE INSERT ON object_revisions
      FOR EACH ROW EXECUTE FUNCTION reject_snapshot();
    `);
    for (const request of [
      {
        method: "PATCH" as const,
        url: `/api/events/${event.id}`,
        payload: { expectedVersion: 1, displayName: "Not committed" },
      },
      {
        method: "POST" as const,
        url: "/api/events",
        payload: { displayName: "Not created" },
      },
    ]) {
      const response = await app.inject({
        ...request,
        headers: headers(owner),
      });
      expect(response.statusCode).toBe(500);
    }
    const states = await database.connection.db.select().from(objects);
    expect(states).toMatchObject([
      { id: event.id, displayName: "Original", version: 1 },
    ]);
    const audits = await database.connection
      .sql`SELECT action FROM audit_events WHERE resource_id IS NOT NULL`;
    expect(audits).toEqual([{ action: "event.created" }]);
    expect(
      await database.connection.db.select().from(objectRevisions),
    ).toHaveLength(1);
  });

  it("captures honest, repeatable baselines for live and deleted pre-existing objects", async () => {
    const owner = await signIn("owner@example.com");
    for (const deleted of [false, true]) {
      const id = createId();
      await database.connection.db.insert(objects).values({
        id,
        workspaceId: owner.workspace.id,
        objectType: "event",
        displayName: "Existing Event",
        createdBy: owner.user.id,
        permissionScopeId: id,
        version: 7,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        ...(deleted && { deletedAt: new Date() }),
      });
      await database.connection.db.insert(events).values({
        objectId: id,
        workspaceId: owner.workspace.id,
        startsAt: new Date("2026-10-01T12:00:00Z"),
      });
    }
    await expect(
      assertRevisionBaseline(database.connection.db),
    ).rejects.toThrow("baseline is missing");
    await expect(baselineObjectRevisions(database.connection.db)).resolves.toBe(
      2,
    );
    await expect(baselineObjectRevisions(database.connection.db)).resolves.toBe(
      0,
    );
    await expect(
      assertRevisionBaseline(database.connection.db),
    ).resolves.toBeUndefined();
    const revisions = await database.connection.db
      .select()
      .from(objectRevisions);
    expect(revisions).toHaveLength(2);
    for (const revision of revisions) {
      expect(revision).toMatchObject({
        objectVersion: 7,
        mutationKind: "baseline",
        actorType: "system",
        actorId: null,
      });
      expect(revision.snapshot.startsAt).toBe("2026-10-01T12:00:00.000Z");
    }
    expect(
      revisions.filter((revision) => revision.snapshot.deletedAt !== null),
    ).toHaveLength(1);
    await database.connection.db.update(objects).set({ version: 8 });
    await expect(
      baselineObjectRevisions(database.connection.db),
    ).rejects.toThrow("baseline cannot repair history");
  });
});
