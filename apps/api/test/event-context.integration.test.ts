import { resolve } from "node:path";

import { createId } from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  developmentSignInResponseSchema,
  eventContextCreateResponseSchema,
  eventResponseSchema,
} from "@chronelle/schemas";
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
async function fixture() {
  const owner = await signIn("owner@example.com");
  const response = await app.inject({
    method: "POST",
    url: "/api/events",
    headers: headers(owner),
    payload: { displayName: "Launch" },
  });
  expect(response.statusCode).toBe(201);
  const event = eventResponseSchema.parse(response.json());
  const command = {
    commandId: createId(),
    resource: { objectType: "task", displayName: "Confirm venue" },
    relationMetadata: { section: "Logistics", position: 1 },
  };
  const post = (payload = command) =>
    app.inject({
      method: "POST",
      url: `/api/events/${event.id}/resources`,
      headers: headers(owner),
      payload,
    });
  return { owner, event, command, post };
}

describe.sequential("atomic Event context commands", () => {
  it("deduplicates concurrent requests and replays the original result without undoing edits or unlinks", async () => {
    const { owner, event, command, post } = await fixture();
    const concurrent = await Promise.all([post(), post(), post()]);
    for (const response of concurrent) expect(response.statusCode).toBe(201);
    const result = eventContextCreateResponseSchema.parse(
      concurrent[0]?.json(),
    );
    expect(concurrent.map((response) => response.json())).toEqual([
      result,
      result,
      result,
    ]);
    const reordered = await post({
      ...command,
      relationMetadata: { position: 1, section: "Logistics" },
    });
    expect(reordered.json()).toEqual(result);
    expect(result.resource.permissionScopeId).toBe(event.id);
    const relations = await database.connection
      .sql`SELECT metadata FROM object_relations WHERE id = ${result.relationId}`;
    expect(relations[0]?.metadata).toEqual(command.relationMetadata);
    const changed = await post({
      ...command,
      resource: { ...command.resource, displayName: "Different command" },
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.code).toBe("command_conflict");
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${result.resource.id}`,
      headers: headers(owner),
      payload: { expectedVersion: 1, displayName: "Current value" },
    });
    expect(edited.statusCode).toBe(200);
    const unlinked = await app.inject({
      method: "DELETE",
      url: `/api/relations/${result.relationId}?expectedVersion=1`,
      headers: headers(owner),
    });
    expect(unlinked.statusCode).toBe(200);
    expect((await post()).json()).toEqual(result);
    const current = await app.inject({
      method: "GET",
      url: `/api/tasks/${result.resource.id}`,
      headers: headers(owner),
    });
    expect(current.json()).toMatchObject({
      displayName: "Current value",
      version: 2,
    });
    const detail = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/detail`,
      headers: headers(owner),
    });
    expect(detail.json().tasks).toEqual([]);
    expect(await database.connection.sql`SELECT id FROM objects`).toHaveLength(
      2,
    );
    expect(
      await database.connection
        .sql`SELECT command_id FROM event_context_commands`,
    ).toHaveLength(1);
    expect(
      await database.connection.sql`SELECT id FROM object_revisions`,
    ).toHaveLength(3);
    const audits = await database.connection.sql`
      SELECT a.action FROM audit_events a JOIN event_context_commands c ON c.request_id = a.request_id ORDER BY a.action
    `;
    expect(audits).toEqual([
      { action: "relation.created" },
      { action: "task.created" },
    ]);
    for (const mutation of [
      "UPDATE event_context_commands SET request_hash = repeat('0', 64)",
      "DELETE FROM event_context_commands",
      "TRUNCATE event_context_commands",
    ])
      await expect(
        database.connection.sql.unsafe(mutation),
      ).rejects.toMatchObject({ code: "55000" });
  });

  it("creates every supported planning child in one committed context", async () => {
    const { owner, event } = await fixture();
    for (const resource of [
      {
        objectType: "event",
        displayName: "Arrival",
        startsAt: "2026-10-01T12:00:00Z",
        timezone: "UTC",
      },
      { objectType: "task", displayName: "Checklist" },
      {
        objectType: "expense",
        displayName: "Deposit",
        amount: "12.1234",
        currency: "USD",
        occurredAt: "2026-09-01T12:00:00Z",
      },
      {
        objectType: "reminder",
        displayName: "Briefing",
        remindAt: "2026-09-30T12:00:00Z",
      },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/events/${event.id}/resources`,
        headers: headers(owner),
        payload: { commandId: createId(), resource },
      });
      expect(response.statusCode).toBe(201);
      const result = eventContextCreateResponseSchema.parse(response.json());
      const snapshot = await app.inject({
        method: "GET",
        url: `/api/objects/${result.resource.id}/revisions/1`,
        headers: headers(owner),
      });
      expect(snapshot.statusCode).toBe(200);
      expect(snapshot.json().snapshot).toMatchObject({
        id: result.resource.id,
        objectType: resource.objectType,
      });
    }
    const detail = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/detail`,
      headers: headers(owner),
    });
    for (const collection of ["events", "tasks", "expenses", "reminders"])
      expect(detail.json()[collection]).toHaveLength(1);
  });

  it.each(["relation", "revision", "audit", "command"] as const)(
    "rolls everything back when the %s write fails",
    async (stage) => {
      const { post } = await fixture();
      const table = {
        relation: "object_relations",
        revision: "object_revisions",
        audit: "audit_events",
        command: "event_context_commands",
      }[stage];
      const condition =
        stage === "audit"
          ? "IF NEW.action <> 'relation.created' THEN RETURN NEW; END IF;"
          : "";
      await database.connection.sql
        .unsafe(`CREATE FUNCTION fail_context_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN ${condition} RAISE EXCEPTION 'write unavailable'; END; $$;
      CREATE TRIGGER fail_context_write BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_context_write();`);
      expect((await post()).statusCode).toBe(500);
      expect(
        await database.connection.sql`SELECT id FROM objects`,
      ).toHaveLength(1);
      expect(
        await database.connection.sql`SELECT id FROM object_relations`,
      ).toHaveLength(0);
      expect(
        await database.connection.sql`SELECT id FROM object_revisions`,
      ).toHaveLength(1);
      expect(
        await database.connection
          .sql`SELECT command_id FROM event_context_commands`,
      ).toHaveLength(0);
      expect(
        await database.connection
          .sql`SELECT action FROM audit_events WHERE resource_id IS NOT NULL`,
      ).toEqual([{ action: "event.created" }]);
      await database.connection.sql.unsafe(
        `DROP TRIGGER fail_context_write ON ${table}`,
      );
      expect((await post()).statusCode).toBe(201);
    },
  );

  it("scopes command identity by actor and reauthorizes retries", async () => {
    const { owner, event, command, post } = await fixture();
    const editor = await signIn("editor@example.com");
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
    expect(share.statusCode).toBe(201);
    const result = (await post()).json();
    const editorPost = () =>
      app.inject({
        method: "POST",
        url: `/api/events/${event.id}/resources`,
        headers: headers(editor, owner.workspace.id),
        payload: command,
      });
    const other = await editorPost();
    expect(other.statusCode).toBe(201);
    expect(other.json().resource.id).not.toBe(result.resource.id);
    const privateScope = await app.inject({
      method: "PATCH",
      url: `/api/objects/${other.json().resource.id}/permission-scope`,
      headers: headers(owner),
      payload: {
        expectedVersion: 1,
        permissionScopeId: other.json().resource.id,
      },
    });
    expect(privateScope.statusCode).toBe(200);
    expect((await editorPost()).statusCode).toBe(404);
    const revoke = await app.inject({
      method: "DELETE",
      url: `/api/shares/${share.json().id}`,
      headers: headers(owner),
    });
    expect(revoke.statusCode).toBe(200);
    expect((await editorPost()).statusCode).toBe(404);
    const crossed = await app.inject({
      method: "POST",
      url: `/api/events/${event.id}/resources`,
      headers: headers(editor),
      payload: command,
    });
    expect(crossed.statusCode).toBe(404);
    expect(
      await database.connection
        .sql`SELECT command_id FROM event_context_commands`,
    ).toHaveLength(2);
  });
});
