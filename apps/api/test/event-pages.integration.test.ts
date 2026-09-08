import { resolve } from "node:path";
import { auditEvents, createId, eventPageRevisions } from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  developmentSignInResponseSchema,
  eventComponentKindSchema,
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
  it("paginates immutable history and restores snapshots without changing the Event", async () => {
    const { owner, event, url } = await fixture();
    const page = {
      id: createId(),
      name: "Preparation",
      components: [{ id: createId(), kind: "todos" }],
    };
    for (const [expectedVersion, pages] of [
      [0, [page]],
      [1, []],
      [2, [{ ...page, name: "On the day" }]],
    ] as const) {
      expect(
        (
          await app.inject({
            method: "PATCH",
            url,
            headers: owner.headers,
            payload: { expectedVersion, pages },
          })
        ).statusCode,
      ).toBe(200);
    }
    const first = await app.inject({
      url: `${url}/history?limit=2`,
      headers: owner.headers,
    });
    expect(first.statusCode).toBe(200);
    expect(
      first.json().items.map((item: { version: number }) => item.version),
    ).toEqual([3, 2]);
    expect(first.json().nextBeforeVersion).toBe(2);
    const second = await app.inject({
      url: `${url}/history?beforeVersion=2&limit=2`,
      headers: owner.headers,
    });
    expect(second.json()).toMatchObject({
      items: [{ version: 1, pages: [page] }],
      nextBeforeVersion: null,
    });
    const restored = await app.inject({
      method: "POST",
      url: `${url}/restore`,
      headers: owner.headers,
      payload: { expectedVersion: 3, targetVersion: 1 },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ version: 4, pages: [page] });
    expect(
      (
        await app.inject({
          url: `/api/events/${event.id}`,
          headers: owner.headers,
        })
      ).json(),
    ).toEqual(event);
    const audit = await database.connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.resourceId, event.id));
    expect(
      audit.filter((row) => row.action === "event.layout_restored"),
    ).toMatchObject([
      { metadata: { previousVersion: 3, version: 4, restoredFromVersion: 1 } },
    ]);
    expect(
      (
        await app.inject({
          url: `${url}/history?beforeVersion=2`,
          headers: owner.headers,
        })
      ).json().items[0].pages,
    ).toEqual([page]);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${url}/restore`,
          headers: owner.headers,
          payload: { expectedVersion: 3, targetVersion: 0 },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${url}/restore`,
          headers: owner.headers,
          payload: { expectedVersion: 4, targetVersion: 99 },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${url}/restore`,
          headers: owner.headers,
          payload: { expectedVersion: 4, targetVersion: 0 },
        })
      ).json(),
    ).toMatchObject({ version: 5, pages: [] });
    expect(
      (await database.connection.db.select().from(eventPageRevisions)).length,
    ).toBe(5);
  });

  it("authorizes history and restoration independently of references and workspace IDs", async () => {
    const { owner, event, url } = await fixture();
    const viewer = await signIn("history-viewer@example.test");
    const stranger = await signIn("history-stranger@example.test");
    await app.inject({
      method: "PATCH",
      url,
      headers: owner.headers,
      payload: { expectedVersion: 0, pages: [] },
    });
    const shared = await app.inject({
      method: "POST",
      url: "/api/shares",
      headers: owner.headers,
      payload: {
        resourceId: event.id,
        principalEmail: "history-viewer@example.test",
        role: "viewer",
      },
    });
    expect(shared.statusCode).toBe(201);
    const viewerHeaders = {
      ...viewer.headers,
      "x-workspace-id": owner.session.workspace.id,
    };
    expect(
      (await app.inject({ url: `${url}/history`, headers: viewerHeaders }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${url}/restore`,
          headers: viewerHeaders,
          payload: { expectedVersion: 1, targetVersion: 0 },
        })
      ).statusCode,
    ).toBe(404);
    for (const headers of [stranger.headers, owner.headers]) {
      const foreignUrl =
        headers === owner.headers ? `/api/events/${createId()}/layout` : url;
      expect(
        (await app.inject({ url: `${foreignUrl}/history`, headers }))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `${foreignUrl}/restore`,
            headers,
            payload: { expectedVersion: 1, targetVersion: 0 },
          })
        ).statusCode,
      ).toBe(404);
    }
    expect(
      (
        await app.inject({
          url: `${url}/history?limit=21`,
          headers: owner.headers,
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.inject({ url: `${url}/history` })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/shares/${shared.json().id}`,
          headers: owner.headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: `${url}/history?beforeVersion=2`,
          headers: viewerHeaders,
        })
      ).statusCode,
    ).toBe(404);
    const other = await app.inject({
      method: "POST",
      url: "/api/events",
      headers: owner.headers,
      payload: { displayName: "Another event" },
    });
    expect(other.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/events/${other.json().id}/layout/restore`,
          headers: owner.headers,
          payload: { expectedVersion: 0, targetVersion: 1 },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/objects/${event.id}?expectedVersion=${event.version}`,
          headers: owner.headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: `${url}/history`, headers: owner.headers }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${url}/restore`,
          headers: owner.headers,
          payload: { expectedVersion: 1, targetVersion: 0 },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      await database.connection.db.select().from(eventPageRevisions),
    ).toHaveLength(1);
  });

  it("serializes competing restores and audits only the successful mutation", async () => {
    const { owner, event, url } = await fixture();
    await app.inject({
      method: "PATCH",
      url,
      headers: owner.headers,
      payload: { expectedVersion: 0, pages: [] },
    });
    const results = await Promise.all(
      [0, 1].map(() =>
        app.inject({
          method: "POST",
          url: `${url}/restore`,
          headers: owner.headers,
          payload: { expectedVersion: 1, targetVersion: 0 },
        }),
      ),
    );
    expect(results.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
    const audit = await database.connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.resourceId, event.id));
    expect(
      audit.filter((row) => row.action === "event.layout_restored"),
    ).toHaveLength(1);
  });

  it("does not grant access to private related records when their components are shared", async () => {
    const { owner, event, url } = await fixture();
    const viewer = await signIn("component-viewer@example.test");
    const privateIds: string[] = [];
    for (const [route, fields] of [
      ["events", { startsOn: "2030-07-04", endsOn: "2030-07-06" }],
      ["tasks", { dueAt: "2030-07-04T10:00:00Z" }],
      [
        "expenses",
        {
          amount: "20.0000",
          currency: "USD",
          occurredAt: "2030-07-04T10:00:00Z",
        },
      ],
      ["reminders", { remindAt: "2030-07-04T10:00:00Z" }],
    ] as const) {
      const created = await app.inject({
        method: "POST",
        url: `/api/${route}`,
        headers: owner.headers,
        payload: { displayName: `Private ${route}`, ...fields },
      });
      expect(created.statusCode).toBe(201);
      privateIds.push(created.json().id);
      const linked = await app.inject({
        method: "POST",
        url: `/api/objects/${event.id}/relations`,
        headers: owner.headers,
        payload: {
          relationType: "includes",
          targetObjectId: created.json().id,
        },
      });
      expect(linked.statusCode).toBe(201);
    }
    const pages = [
      {
        id: createId(),
        name: "Plan",
        components: eventComponentKindSchema.options.map((kind) => ({
          id: createId(),
          kind,
        })),
      },
    ];
    expect(
      (
        await app.inject({
          method: "PATCH",
          url,
          headers: owner.headers,
          payload: { expectedVersion: 0, pages },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/shares",
          headers: owner.headers,
          payload: {
            resourceId: event.id,
            principalEmail: "component-viewer@example.test",
            role: "viewer",
          },
        })
      ).statusCode,
    ).toBe(201);
    const viewerHeaders = {
      ...viewer.headers,
      "x-workspace-id": owner.session.workspace.id,
    };
    expect(
      (await app.inject({ url, headers: viewerHeaders })).json().pages,
    ).toEqual(pages);
    for (const projection of [
      "calendar",
      "itinerary",
      "timeline",
      "todos",
      "expenses",
      "reminders",
    ]) {
      const response = await app.inject({
        url: `/api/events/${event.id}/${projection}`,
        headers: viewerHeaders,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().items).toEqual([]);
    }
    const detail = await app.inject({
      url: `/api/events/${event.id}/detail`,
      headers: viewerHeaders,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      events: [],
      tasks: [],
      expenses: [],
      reminders: [],
      documents: [],
      lockedRelationCount: 4,
    });
    for (const id of privateIds) {
      expect(detail.body).not.toContain(id);
      expect(
        (
          await app.inject({
            url: `/api/objects/${id}`,
            headers: viewerHeaders,
          })
        ).statusCode,
      ).toBe(404);
    }
    expect(
      (
        await app.inject({
          method: "PATCH",
          url,
          headers: viewerHeaders,
          payload: { expectedVersion: 1, pages: [] },
        })
      ).statusCode,
    ).toBe(404);
  });

  it.each(["update", "restore"] as const)(
    "rolls back the audit when layout %s persistence fails",
    async (operation) => {
      const { owner, url } = await fixture();
      await database.connection.sql.unsafe(`
      CREATE FUNCTION reject_layout() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected layout failure'; END; $$;
      CREATE TRIGGER reject_layout BEFORE INSERT ON event_page_revisions
      FOR EACH ROW EXECUTE FUNCTION reject_layout();
    `);
      const response = await app.inject({
        method: operation === "update" ? "PATCH" : "POST",
        url: operation === "update" ? url : `${url}/restore`,
        headers: owner.headers,
        payload:
          operation === "update"
            ? { expectedVersion: 0, pages: [] }
            : { expectedVersion: 0, targetVersion: 0 },
      });
      expect(response.statusCode).toBe(500);
      expect(
        await database.connection.db.select().from(eventPageRevisions),
      ).toHaveLength(0);
      expect(
        await database.connection.db
          .select()
          .from(auditEvents)
          .where(
            eq(
              auditEvents.action,
              operation === "update"
                ? "event.layout_updated"
                : "event.layout_restored",
            ),
          ),
      ).toHaveLength(0);
      expect(
        (await app.inject({ url, headers: owner.headers })).json(),
      ).toMatchObject({ version: 0, pages: [] });
    },
  );

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
        components: eventComponentKindSchema.options.map((kind) => ({
          id: createId(),
          kind,
        })),
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
