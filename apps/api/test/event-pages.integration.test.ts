import { resolve } from "node:path";
import { auditEvents, createId, eventPageRevisions } from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  developmentSignInResponseSchema,
  eventLayoutResponseSchema,
  eventResponseSchema,
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
  expect(response.statusCode).toBe(200);
  const session = developmentSignInResponseSchema.parse(response.json());
  return {
    session,
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-workspace-id": session.workspace.id,
    },
  };
}

async function fixture() {
  const owner = await signIn("planner@example.test");
  const response = await app.inject({
    method: "POST",
    url: "/api/events",
    headers: owner.headers,
    payload: { displayName: "Summer vacation" },
  });
  expect(response.statusCode).toBe(201);
  const event = eventResponseSchema.parse(response.json());
  return { owner, event, url: `/api/events/${event.id}/layout` };
}

describe.sequential("event page layouts", () => {
  it("rolls back the audit when layout persistence fails", async () => {
    const { owner, url } = await fixture();
    await database.connection.sql.unsafe(`
      CREATE FUNCTION reject_layout() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected layout failure'; END; $$;
      CREATE TRIGGER reject_layout BEFORE INSERT ON event_page_revisions
      FOR EACH ROW EXECUTE FUNCTION reject_layout();
    `);
    const response = await app.inject({
      method: "PATCH",
      url,
      headers: owner.headers,
      payload: { expectedVersion: 0, pages: [] },
    });
    expect(response.statusCode).toBe(500);
    expect(
      await database.connection.db.select().from(eventPageRevisions),
    ).toHaveLength(0);
    expect(
      await database.connection.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "event.layout_updated")),
    ).toHaveLength(0);
    expect(
      (await app.inject({ url, headers: owner.headers })).json(),
    ).toMatchObject({ version: 0, pages: [] });
  });

  it("persists independently versioned layout history without changing canonical records", async () => {
    const { owner, event, url } = await fixture();
    const read = await app.inject({ url, headers: owner.headers });
    expect(eventLayoutResponseSchema.parse(read.json())).toEqual({
      eventId: event.id,
      version: 0,
      updatedAt: null,
      pages: [],
    });
    expect(
      await database.connection.db.select().from(eventPageRevisions),
    ).toHaveLength(0);
    const pages = [
      {
        id: createId(),
        name: "Preparation",
        components: [{ id: createId(), kind: "todos" }],
      },
    ];
    const saved = await app.inject({
      method: "PATCH",
      url,
      headers: owner.headers,
      payload: { expectedVersion: 0, pages },
    });
    expect(saved.statusCode).toBe(200);
    expect(eventLayoutResponseSchema.parse(saved.json())).toMatchObject({
      eventId: event.id,
      version: 1,
      pages,
    });
    expect((await app.inject({ url, headers: owner.headers })).json()).toEqual(
      saved.json(),
    );
    expect(
      (
        await app.inject({
          url: `/api/events/${event.id}`,
          headers: owner.headers,
        })
      ).json(),
    ).toEqual(event);
    const conflict = await app.inject({
      method: "PATCH",
      url,
      headers: owner.headers,
      payload: { expectedVersion: 0, pages: [] },
    });
    expect(conflict.statusCode).toBe(409);
    const removed = await app.inject({
      method: "PATCH",
      url,
      headers: owner.headers,
      payload: { expectedVersion: 1, pages: [] },
    });
    expect(removed.statusCode).toBe(200);
    const revisions = await database.connection.db
      .select()
      .from(eventPageRevisions)
      .orderBy(eventPageRevisions.version);
    expect(revisions.map((revision) => revision.pages)).toEqual([pages, []]);
    const audits = await database.connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "event.layout_updated"));
    expect(audits).toHaveLength(2);
    expect(audits.map((audit) => audit.id).sort()).toEqual(
      revisions.map((revision) => revision.auditEventId).sort(),
    );
    expect(
      audits.every(
        (audit) =>
          audit.resourceId === event.id &&
          audit.actorId === owner.session.user.id,
      ),
    ).toBe(true);
    await expect(
      database.connection.sql`UPDATE event_page_revisions SET pages = '[]'`,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      database.connection.sql`DELETE FROM event_page_revisions`,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      database.connection.sql`TRUNCATE event_page_revisions`,
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("authorizes reads and writes through the Event scope and rejects cross-workspace access", async () => {
    const { owner, event, url } = await fixture();
    const viewer = await signIn("viewer@example.test");
    const stranger = await signIn("stranger@example.test");
    const shared = await app.inject({
      method: "POST",
      url: "/api/shares",
      headers: owner.headers,
      payload: {
        resourceId: event.id,
        principalEmail: "viewer@example.test",
        role: "viewer",
      },
    });
    expect(shared.statusCode).toBe(201);
    const viewerHeaders = {
      ...viewer.headers,
      "x-workspace-id": owner.session.workspace.id,
    };
    expect((await app.inject({ url, headers: viewerHeaders })).statusCode).toBe(
      200,
    );
    expect(
      (
        await app.inject({
          method: "PATCH",
          url,
          headers: viewerHeaders,
          payload: { expectedVersion: 0, pages: [] },
        })
      ).statusCode,
    ).toBe(404);
    for (const headers of [
      viewer.headers,
      stranger.headers,
      { ...stranger.headers, "x-workspace-id": owner.session.workspace.id },
    ]) {
      expect([403, 404]).toContain(
        (await app.inject({ url, headers })).statusCode,
      );
      expect([403, 404]).toContain(
        (
          await app.inject({
            method: "PATCH",
            url,
            headers,
            payload: { expectedVersion: 0, pages: [] },
          })
        ).statusCode,
      );
    }
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect(
      await database.connection.db.select().from(eventPageRevisions),
    ).toHaveLength(0);
    await app.inject({
      method: "DELETE",
      url: `/api/objects/${event.id}?expectedVersion=${event.version}`,
      headers: owner.headers,
    });
    expect((await app.inject({ url, headers: viewerHeaders })).statusCode).toBe(
      404,
    );
  });

  it("serializes concurrent first saves and rejects unvalidated layout data", async () => {
    const { owner, url } = await fixture();
    const invalid = await app.inject({
      method: "PATCH",
      url,
      headers: owner.headers,
      payload: { expectedVersion: 0, pages: [], workspaceId: createId() },
    });
    expect(invalid.statusCode).toBe(400);
    const saves = await Promise.all(
      ["Preparation", "Travel"].map((name) =>
        app.inject({
          method: "PATCH",
          url,
          headers: owner.headers,
          payload: {
            expectedVersion: 0,
            pages: [{ id: createId(), name, components: [] }],
          },
        }),
      ),
    );
    expect(saves.map((save) => save.statusCode).sort()).toEqual([200, 409]);
    expect(
      await database.connection.db.select().from(eventPageRevisions),
    ).toHaveLength(1);
    expect(
      await database.connection.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "event.layout_updated")),
    ).toHaveLength(1);
  });
});
