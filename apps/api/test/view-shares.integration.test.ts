import { resolve } from "node:path";

import { createId } from "@livtales/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import {
  developmentSignInResponseSchema,
  eventAttachmentTargetsResponseSchema,
  eventResponseSchema,
  objectAccessResponseSchema,
  sectionListResponseSchema,
  sectionResponseSchema,
  shareListResponseSchema,
  shareResponseSchema,
  taskResourceProjectionResponseSchema,
} from "@livtales/schemas";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { createDevelopmentAppDependencies } from "../src/dependencies.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);

let testDatabase: TestDatabase;
let app: FastifyInstance;

beforeEach(async () => {
  testDatabase = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: testDatabase.databaseUrl },
    migrationDirectory,
  );
  app = buildApp(createDevelopmentAppDependencies(testDatabase.connection));
});

afterEach(async () => {
  await app.close();
  await testDatabase.close();
});

async function signIn(email: string, displayName: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/development/sign-in",
    payload: { email, displayName },
  });
  expect(response.statusCode).toBe(200);
  return developmentSignInResponseSchema.parse(response.json());
}

const headers = (
  session: Awaited<ReturnType<typeof signIn>>,
  workspaceId = session.workspace.id,
) => ({
  authorization: `Bearer ${session.accessToken}`,
  "x-workspace-id": workspaceId,
});

/** An Event with a sectioned task, a loose task, an expense, and a schedule item. */
async function plan(ownerHeaders: Record<string, string>) {
  const event = eventResponseSchema.parse(
    (
      await app.inject({
        method: "POST",
        url: "/api/events",
        headers: ownerHeaders,
        payload: { displayName: "Kyoto" },
      })
    ).json(),
  );
  const venue = sectionResponseSchema.parse(
    (
      await app.inject({
        method: "POST",
        url: `/api/events/${event.id}/sections`,
        headers: ownerHeaders,
        payload: { view: "todos", name: "Venue" },
      })
    ).json(),
  );
  for (const resource of [
    { objectType: "task", displayName: "Book the hall", sectionId: venue.id },
    { objectType: "task", displayName: "Order the cake" },
    {
      objectType: "expense",
      displayName: "Venue deposit",
      amount: "240.0000",
      currency: "USD",
      occurredAt: "2030-11-03T12:00:00.000Z",
    },
    {
      objectType: "event",
      displayName: "Lunch",
      startsOn: "2030-11-03",
      endsOn: "2030-11-03",
    },
  ]) {
    const response = await app.inject({
      method: "POST",
      url: `/api/events/${event.id}/resources`,
      headers: ownerHeaders,
      payload: { commandId: createId(), resource },
    });
    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
  }
  return { event, venue };
}

describe("shares narrowed to a view or a section", () => {
  it("shares one view: the viewer opens the Event, reads that view's rows, and nothing else", async () => {
    const owner = await signIn("owner@example.com", "Owner");
    const guest = await signIn("guest@example.com", "Guest");
    const ownerHeaders = headers(owner);
    const guestHeaders = headers(guest, owner.workspace.id);
    const { event } = await plan(ownerHeaders);

    const shared = await app.inject({
      method: "POST",
      url: "/api/shares",
      headers: ownerHeaders,
      payload: {
        resourceId: event.id,
        principalEmail: "guest@example.com",
        role: "editor",
        scope: { view: "todos" },
      },
    });
    expect(shared.statusCode, JSON.stringify(shared.json())).toBe(201);
    expect(shareResponseSchema.parse(shared.json())).toMatchObject({
      role: "editor",
      scope: { view: "todos", sectionId: null },
    });

    const access = await app.inject({
      method: "GET",
      url: `/api/objects/${event.id}/access`,
      headers: guestHeaders,
    });
    expect(access.statusCode).toBe(200);
    expect(objectAccessResponseSchema.parse(access.json())).toMatchObject({
      actions: ["view"],
      source: { kind: "direct", role: "editor" },
      narrowing: { views: ["todos"], sections: [] },
    });

    const todos = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/todos`,
      headers: guestHeaders,
    });
    expect(todos.statusCode).toBe(200);
    const projection = taskResourceProjectionResponseSchema.parse(todos.json());
    expect(projection.items.map((item) => item.displayName).sort()).toEqual([
      "Book the hall",
      "Order the cake",
    ]);
    expect(projection.sections.map((section) => section.name)).toEqual([
      "Venue",
    ]);
    // The other views read as empty, not as refused.
    for (const view of ["expenses", "calendar"]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/events/${event.id}/${view}`,
        headers: guestHeaders,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().items).toEqual([]);
    }
    // The tasks carry the editor role: the guest can edit one.
    const task = projection.items.find(
      (item) => item.displayName === "Order the cake",
    );
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task?.id}`,
      headers: guestHeaders,
      payload: { expectedVersion: task?.version, displayName: "Order cake" },
    });
    expect(edited.statusCode, JSON.stringify(edited.json())).toBe(200);
    // The Event itself is view alone.
    const eventEdit = await app.inject({
      method: "PATCH",
      url: `/api/events/${event.id}`,
      headers: guestHeaders,
      payload: { expectedVersion: event.version, displayName: "Osaka" },
    });
    expect(eventEdit.statusCode).toBe(404);
  });

  it("shares one section: the viewer reads its tasks alone; the listing names the scope; a role changes by account id", async () => {
    const owner = await signIn("owner@example.com", "Owner");
    const guest = await signIn("guest@example.com", "Guest");
    const ownerHeaders = headers(owner);
    const guestHeaders = headers(guest, owner.workspace.id);
    const { event, venue } = await plan(ownerHeaders);

    const shared = await app.inject({
      method: "POST",
      url: "/api/shares",
      headers: ownerHeaders,
      payload: {
        resourceId: event.id,
        principalEmail: "guest@example.com",
        role: "viewer",
        scope: { view: "todos", sectionId: venue.id },
      },
    });
    expect(shared.statusCode).toBe(201);
    const grant = shareResponseSchema.parse(shared.json());

    const todos = taskResourceProjectionResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/events/${event.id}/todos`,
          headers: guestHeaders,
        })
      ).json(),
    );
    expect(todos.items.map((item) => item.displayName)).toEqual([
      "Book the hall",
    ]);
    const targets = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/attachment-targets`,
      headers: guestHeaders,
    });
    expect(targets.statusCode).toBe(200);
    expect(eventAttachmentTargetsResponseSchema.parse(targets.json())).toEqual({
      event: { id: event.id, displayName: event.displayName },
      tasks: todos.items.map(({ id, displayName }) => ({ id, displayName })),
      expenses: [],
    });
    const stranger = await signIn("stranger@example.com", "Stranger");
    const crossWorkspace = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/attachment-targets`,
      headers: headers(stranger),
    });
    expect(crossWorkspace.statusCode).toBe(404);
    const sections = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/sections?view=todos`,
      headers: guestHeaders,
    });
    expect(
      sectionListResponseSchema.parse(sections.json()).items.map((s) => s.name),
    ).toEqual(["Venue"]);
    expect(
      objectAccessResponseSchema.parse(
        (
          await app.inject({
            method: "GET",
            url: `/api/objects/${event.id}/access`,
            headers: guestHeaders,
          })
        ).json(),
      ).narrowing,
    ).toEqual({ views: [], sections: [{ id: venue.id, view: "todos" }] });

    // The share sheet raises the role by the account's id, in place.
    const raised = await app.inject({
      method: "POST",
      url: "/api/shares",
      headers: ownerHeaders,
      payload: {
        resourceId: event.id,
        principalId: guest.user.id,
        role: "editor",
        scope: { view: "todos", sectionId: venue.id },
      },
    });
    expect(raised.statusCode).toBe(201);
    expect(shareResponseSchema.parse(raised.json())).toMatchObject({
      id: grant.id,
      role: "editor",
    });
    const listed = shareListResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/objects/${event.id}/shares`,
          headers: ownerHeaders,
        })
      ).json(),
    );
    expect(listed.items.map((item) => [item.role, item.scope])).toEqual([
      ["editor", { view: "todos", sectionId: venue.id }],
    ]);

    // A narrowed share names an Event, and a section of that view.
    const refused = await app.inject({
      method: "POST",
      url: "/api/shares",
      headers: ownerHeaders,
      payload: {
        resourceId: event.id,
        principalEmail: "guest@example.com",
        role: "viewer",
        scope: { view: "expenses", sectionId: venue.id },
      },
    });
    expect(refused.statusCode).toBe(400);

    // Deleting the section ends the share.
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/sections/${venue.id}`,
      headers: ownerHeaders,
    });
    expect(deleted.statusCode).toBe(200);
    const after = await app.inject({
      method: "GET",
      url: `/api/objects/${event.id}/access`,
      headers: guestHeaders,
    });
    expect(after.statusCode).toBe(404);
  });
});
