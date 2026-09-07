import { resolve } from "node:path";
import { objectRevisions, objects, resourceGrants } from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import { withStableAuthorization } from "@chronelle/authorization";
import {
  developmentSignInResponseSchema,
  eventPlanningResourceResponseSchema,
  relationResponseSchema,
  trashListResponseSchema,
  recoveryPreviewSchema,
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
  return developmentSignInResponseSchema.parse(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/development/sign-in",
        payload: { email, displayName: "Planner" },
      })
    ).json(),
  );
}
type Session = Awaited<ReturnType<typeof signIn>>;
function headers(session: Session, workspaceId = session.workspace.id) {
  return {
    authorization: `Bearer ${session.accessToken}`,
    "x-workspace-id": workspaceId,
  };
}
async function create(
  session: Session,
  type = "events",
  input: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/${type}`,
    headers: headers(session),
    payload: { displayName: "Plan", ...input },
  });
  expect(response.statusCode).toBe(201);
  return eventPlanningResourceResponseSchema.parse(response.json());
}
async function trash(session: Session, id: string, version = 1) {
  const response = await app.inject({
    method: "DELETE",
    url: `/api/objects/${id}?expectedVersion=${version}`,
    headers: headers(session),
  });
  expect(response.statusCode).toBe(200);
}
function recover(
  session: Session,
  id: string,
  version = 2,
  workspaceId = session.workspace.id,
) {
  return app.inject({
    method: "POST",
    url: `/api/objects/${id}/recover`,
    headers: headers(session, workspaceId),
    payload: { expectedVersion: version },
  });
}
async function share(
  owner: Session,
  id: string,
  email: string,
  role = "owner",
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/shares",
    headers: headers(owner),
    payload: { resourceId: id, principalEmail: email, role },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>();
}
async function link(session: Session, sourceId: string, targetId: string) {
  const response = await app.inject({
    method: "POST",
    url: `/api/objects/${sourceId}/relations`,
    headers: headers(session),
    payload: {
      relationType: "includes",
      targetObjectId: targetId,
      metadata: { section: "Logistics" },
    },
  });
  expect(response.statusCode).toBe(201);
  return relationResponseSchema.parse(response.json());
}
describe.sequential("Trash and recovery", () => {
  it("permits only one concurrent recovery at the expected version", async () => {
    const owner = await signIn("owner@example.com");
    const task = await create(owner, "tasks");
    await trash(owner, task.id);
    const responses = await Promise.all([
      recover(owner, task.id),
      recover(owner, task.id),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
    expect(
      await database.connection
        .sql`SELECT id FROM audit_events WHERE action = 'task.recovered'`,
    ).toHaveLength(1);
    const [revision] = await database.connection
      .sql`SELECT mutation_kind, source_revision_id FROM object_revisions WHERE object_id = ${task.id} AND object_version = 3`;
    expect(revision).toEqual({
      mutation_kind: "recovered",
      source_revision_id: null,
    });
  });

  it("filters inaccessible removed links before pagination, including incoming links", async () => {
    const owner = await signIn("owner@example.com");
    const collaborator = await signIn("collaborator@example.com");
    const event = await create(owner);
    await share(owner, event.id, "collaborator@example.com");
    const visible = await create(owner, "events", {
      permissionScopeId: event.id,
    });
    const privateTask = await create(owner, "tasks", {
      displayName: "Private hidden title",
    });
    const outgoing = await link(owner, event.id, visible.id);
    const incoming = await link(owner, visible.id, event.id);
    const hidden = await link(owner, event.id, privateTask.id);
    for (const relation of [outgoing, incoming, hidden]) {
      expect(
        (
          await app.inject({
            method: "DELETE",
            url: `/api/relations/${relation.id}?expectedVersion=1`,
            headers: headers(owner),
          })
        ).statusCode,
      ).toBe(200);
    }
    const first = await app.inject({
      url: `/api/objects/${event.id}/removed-relations?limit=1`,
      headers: headers(collaborator, owner.workspace.id),
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      url: `/api/objects/${event.id}/removed-relations?limit=1&cursor=${first.json().nextCursor}`,
      headers: headers(collaborator, owner.workspace.id),
    });
    expect(
      [
        first.json().items[0].relation.id,
        second.json().items[0].relation.id,
      ].sort(),
    ).toEqual([outgoing.id, incoming.id].sort());
    expect(second.json().nextCursor).toBeNull();
    const filtered = await app.inject({
      url: `/api/objects/${event.id}/removed-relations?relationType=includes&limit=1`,
      headers: headers(collaborator, owner.workspace.id),
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().items).toHaveLength(1);
    for (const query of [
      "limit=51",
      "cursor=bad!",
      "cursor=e30",
      "relationType=unknown",
      `beforeId=${outgoing.id}`,
      `relationType=includes&cursor=${first.json().nextCursor}`,
    ]) {
      const response = await app.inject({
        url: `/api/objects/${event.id}/removed-relations?${query}`,
        headers: headers(collaborator, owner.workspace.id),
      });
      expect(response.statusCode).toBe(400);
    }
    expect(first.body + second.body).not.toContain(privateTask.id);
    expect(first.body + second.body).not.toContain(privateTask.displayName);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/relations/${hidden.id}/recover`,
          headers: headers(collaborator, owner.workspace.id),
          payload: { expectedVersion: 2 },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("does not revive expired grants or inheritance stopped at the object itself", async () => {
    const owner = await signIn("owner@example.com");
    const collaborator = await signIn("collaborator@example.com");
    const event = await create(owner);
    const privateTask = await create(owner, "tasks");
    await link(owner, event.id, privateTask.id);
    const grant = await share(owner, event.id, "collaborator@example.com");
    await share(
      owner,
      (await create(owner)).id,
      "collaborator@example.com",
      "viewer",
    );
    await trash(owner, privateTask.id);
    await trash(owner, event.id);
    await database.connection
      .sql`UPDATE resource_grants SET created_at = now() - interval '2 seconds', expires_at = now() - interval '1 second' WHERE id = ${grant.id}`;
    expect(
      (
        await app.inject({
          url: "/api/trash",
          headers: headers(collaborator, owner.workspace.id),
        })
      ).json(),
    ).toEqual({ items: [], nextCursor: null });
    expect((await recover(owner, event.id)).statusCode).toBe(200);
    expect(
      (await recover(collaborator, privateTask.id, 2, owner.workspace.id))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          url: `/api/objects/${event.id}`,
          headers: headers(collaborator, owner.workspace.id),
        })
      ).statusCode,
    ).toBe(404);
  });

  it("enforces relation identity and version invariants in PostgreSQL", async () => {
    const owner = await signIn("owner@example.com");
    const event = await create(owner);
    const task = await create(owner, "tasks");
    const relation = await link(owner, event.id, task.id);
    await expect(
      database.connection
        .sql`UPDATE object_relations SET deleted_at = now() WHERE id = ${relation.id}`,
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database.connection
        .sql`UPDATE object_relations SET version = version + 1, target_object_id = ${event.id} WHERE id = ${relation.id}`,
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/relations/${relation.id}`,
          headers: headers(owner),
        })
      ).statusCode,
    ).toBe(400);
  });

  it("recovers one canonical object, preserves facts and links, and records the new version", async () => {
    const owner = await signIn("owner@example.com");
    const event = await create(owner);
    const task = await create(owner, "tasks", {
      displayName: "Book venue",
      permissionScopeId: event.id,
    });
    const relation = await link(owner, event.id, task.id);
    await trash(owner, task.id);
    const preview = recoveryPreviewSchema.parse(
      (
        await app.inject({
          url: `/api/objects/${task.id}/recovery-preview`,
          headers: headers(owner),
        })
      ).json(),
    );
    expect(preview).toMatchObject({
      object: { id: task.id, version: 2 },
      canRecover: true,
    });
    expect(
      (
        await app.inject({
          url: `/api/objects/${task.id}`,
          headers: headers(owner),
        })
      ).statusCode,
    ).toBe(404);
    const response = await recover(owner, task.id);
    expect(response.statusCode).toBe(200);
    expect(
      eventPlanningResourceResponseSchema.parse(response.json()),
    ).toMatchObject({
      id: task.id,
      version: 3,
      deletedAt: null,
      permissionScopeId: event.id,
      status: "todo",
    });
    const projection = await app.inject({
      url: `/api/events/${event.id}/todos`,
      headers: headers(owner),
    });
    expect(projection.json().items).toMatchObject([
      { id: task.id, version: 3 },
    ]);
    const [stored] = await database.connection
      .sql`SELECT * FROM object_relations WHERE id = ${relation.id}`;
    expect(stored).toMatchObject({
      deleted_at: null,
      version: 1,
      metadata: { section: "Logistics" },
    });
    const [revision] = await database.connection.db
      .select()
      .from(objectRevisions)
      .where(eq(objectRevisions.objectId, task.id))
      .orderBy(objectRevisions.objectVersion);
    expect(revision?.objectVersion).toBe(1);
    expect(
      await database.connection
        .sql`SELECT id FROM object_revisions WHERE object_id = ${task.id}`,
    ).toHaveLength(3);
    expect(
      await database.connection
        .sql`SELECT id FROM audit_events WHERE action = 'task.recovered'`,
    ).toHaveLength(1);
    expect((await recover(owner, task.id)).statusCode).toBe(409);
  });

  it("keeps shared Owner recovery scoped and requires the deleted permission scope first", async () => {
    const owner = await signIn("owner@example.com");
    const collaborator = await signIn("collaborator@example.com");
    const event = await create(owner);
    const child = await create(owner, "tasks", { permissionScopeId: event.id });
    const privateTask = await create(owner, "tasks", {
      displayName: "Private",
    });
    await share(owner, event.id, "collaborator@example.com");
    await trash(owner, child.id);
    await trash(owner, privateTask.id);
    await trash(owner, event.id);
    const list = await app.inject({
      url: "/api/trash",
      headers: headers(collaborator, owner.workspace.id),
    });
    expect(list.statusCode).toBe(200);
    expect(
      trashListResponseSchema
        .parse(list.json())
        .items.map((item) => item.id)
        .sort(),
    ).toEqual([event.id, child.id].sort());
    const preview = await app.inject({
      url: `/api/objects/${child.id}/recovery-preview`,
      headers: headers(collaborator, owner.workspace.id),
    });
    expect(preview.json()).toMatchObject({ canRecover: false });
    expect(
      (await recover(collaborator, child.id, 2, owner.workspace.id)).statusCode,
    ).toBe(400);
    expect(
      (await recover(collaborator, privateTask.id, 2, owner.workspace.id))
        .statusCode,
    ).toBe(404);
    expect(
      (await recover(collaborator, event.id, 2, owner.workspace.id)).statusCode,
    ).toBe(200);
    expect(
      (await recover(collaborator, child.id, 2, owner.workspace.id)).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: `/api/objects/${privateTask.id}`,
          headers: headers(collaborator, owner.workspace.id),
        })
      ).statusCode,
    ).toBe(404);
  });

  it.each(["viewer", "editor"])(
    "does not expose tombstones to a shared %s",
    async (role) => {
      const owner = await signIn("owner@example.com");
      const collaborator = await signIn("collaborator@example.com");
      const event = await create(owner);
      const anchor = await create(owner);
      await share(owner, event.id, "collaborator@example.com", role);
      await share(owner, anchor.id, "collaborator@example.com", "viewer");
      await trash(owner, event.id);
      expect(
        (
          await app.inject({
            url: "/api/trash",
            headers: headers(collaborator, owner.workspace.id),
          })
        ).json(),
      ).toEqual({ items: [], nextCursor: null });
      expect(
        (await recover(collaborator, event.id, 2, owner.workspace.id))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            url: `/api/objects/${event.id}/recovery-preview`,
            headers: headers(collaborator, owner.workspace.id),
          })
        ).statusCode,
      ).toBe(404);
    },
  );

  it("paginates only authorized filtered objects and rejects forged versions and workspaces", async () => {
    const owner = await signIn("owner@example.com");
    const stranger = await signIn("stranger@example.com");
    const event = await create(owner);
    const first = await create(owner, "tasks", { permissionScopeId: event.id });
    const second = await create(owner, "tasks", {
      permissionScopeId: event.id,
    });
    await trash(owner, first.id);
    await trash(owner, second.id);
    await trash(owner, event.id);
    const one = trashListResponseSchema.parse(
      (
        await app.inject({
          url: `/api/trash?objectType=task&scopeId=${event.id}&limit=1`,
          headers: headers(owner),
        })
      ).json(),
    );
    const two = trashListResponseSchema.parse(
      (
        await app.inject({
          url: `/api/trash?objectType=task&scopeId=${event.id}&limit=1&cursor=${one.nextCursor}`,
          headers: headers(owner),
        })
      ).json(),
    );
    expect(
      new Set([...one.items, ...two.items].map((item) => item.id)).size,
    ).toBe(2);
    expect(two.nextCursor).toBeNull();
    for (const query of [
      `cursor=${one.nextCursor}`,
      `objectType=event&scopeId=${event.id}&cursor=${one.nextCursor}`,
      `objectType=task&scopeId=${first.id}&cursor=${one.nextCursor}`,
      "cursor=e30",
      "cursor=bad!",
      `beforeId=${first.id}`,
    ]) {
      expect(
        (
          await app.inject({
            url: `/api/trash?${query}`,
            headers: headers(owner),
          })
        ).statusCode,
      ).toBe(400);
    }
    const foreignCursor = await app.inject({
      url: `/api/trash?objectType=task&scopeId=${event.id}&cursor=${one.nextCursor}`,
      headers: headers(stranger),
    });
    expect(foreignCursor.statusCode).toBe(400);
    expect(foreignCursor.body).not.toContain(first.displayName);
    expect((await recover(stranger, first.id)).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          url: "/api/trash?limit=101",
          headers: headers(owner),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/objects/${first.id}/recover`,
          headers: headers(owner),
          payload: { expectedVersion: 2, permissionScopeId: first.id },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("allows revoking grants while trashed and removes shared workspace recovery access", async () => {
    const owner = await signIn("owner@example.com");
    const collaborator = await signIn("collaborator@example.com");
    const event = await create(owner);
    const grant = await share(owner, event.id, "collaborator@example.com");
    await trash(owner, event.id);
    const grants = await app.inject({
      url: `/api/objects/${event.id}/shares`,
      headers: headers(owner),
    });
    expect(grants.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/shares/${grant.id}`,
          headers: headers(owner),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await recover(collaborator, event.id, 2, owner.workspace.id)).statusCode,
    ).not.toBe(200);
    expect(
      (
        await app.inject({
          url: "/api/trash",
          headers: headers(collaborator, owner.workspace.id),
        })
      ).statusCode,
    ).not.toBe(200);
  });

  it("versions independent link recovery, rejects collisions and stale inverses, and preserves removed links during object recovery", async () => {
    const owner = await signIn("owner@example.com");
    const event = await create(owner);
    const task = await create(owner, "tasks");
    const original = await link(owner, event.id, task.id);
    const remove = (id: string, version: number) =>
      app.inject({
        method: "DELETE",
        url: `/api/relations/${id}?expectedVersion=${version}`,
        headers: headers(owner),
      });
    const restore = (version: number) =>
      app.inject({
        method: "POST",
        url: `/api/relations/${original.id}/recover`,
        headers: headers(owner),
        payload: { expectedVersion: version },
      });
    expect((await remove(original.id, 1)).json()).toMatchObject({ version: 2 });
    await trash(owner, task.id);
    expect((await restore(2)).statusCode).toBe(404);
    await recover(owner, task.id);
    expect(
      (
        await app.inject({
          url: `/api/events/${event.id}/todos`,
          headers: headers(owner),
        })
      ).json().items,
    ).toEqual([]);
    const replacement = await link(owner, event.id, task.id);
    expect((await restore(2)).statusCode).toBe(409);
    expect((await remove(replacement.id, 1)).statusCode).toBe(200);
    const response = await restore(2);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: original.id,
      version: 3,
      metadata: { section: "Logistics" },
    });
    expect((await remove(original.id, 1)).statusCode).toBe(409);
    expect((await restore(2)).statusCode).toBe(409);
    expect(
      await database.connection
        .sql`SELECT id FROM audit_events WHERE action = 'relation.recovered'`,
    ).toHaveLength(1);
  });

  it("rolls recovery back when its revision fails", async () => {
    const owner = await signIn("owner@example.com");
    const task = await create(owner, "tasks");
    await trash(owner, task.id);
    await database.connection.sql
      .unsafe(`CREATE FUNCTION fail_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.mutation_kind = 'recovered' THEN RAISE EXCEPTION 'injected revision failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER fail_recovery BEFORE INSERT ON object_revisions FOR EACH ROW EXECUTE FUNCTION fail_recovery();`);
    expect((await recover(owner, task.id)).statusCode).toBe(500);
    const [stored] = await database.connection.db
      .select()
      .from(objects)
      .where(eq(objects.id, task.id));
    expect(stored?.version).toBe(2);
    expect(stored?.deletedAt).not.toBeNull();
    expect(
      await database.connection
        .sql`SELECT id FROM audit_events WHERE action = 'task.recovered'`,
    ).toHaveLength(0);
  });

  it("rechecks an Owner grant after a concurrent revocation wins the workspace lock", async () => {
    const owner = await signIn("owner@example.com");
    const collaborator = await signIn("collaborator@example.com");
    const event = await create(owner);
    const grant = await share(owner, event.id, "collaborator@example.com");
    await share(
      owner,
      (await create(owner)).id,
      "collaborator@example.com",
      "viewer",
    );
    await trash(owner, event.id);
    const held = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const revocation = withStableAuthorization(
      database.connection.db,
      owner.workspace.id,
      async (transaction) => {
        await transaction
          .delete(resourceGrants)
          .where(eq(resourceGrants.id, grant.id));
        held.resolve();
        await release.promise;
      },
    );
    await held.promise;
    const waiting = recover(collaborator, event.id, 2, owner.workspace.id).then(
      (response) => response,
    );
    try {
      await expect
        .poll(async () => {
          const [row] = await database.connection.sql<
            { count: number }[]
          >`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%workspaces%'`;
          return row?.count ?? 0;
        })
        .toBeGreaterThan(0);
    } finally {
      release.resolve();
    }
    await revocation;
    expect((await waiting).statusCode).toBe(404);
  });
});
