import { resolve } from "node:path";

import { createId } from "@livtales/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import {
  developmentSignInResponseSchema,
  eventContextCreateResponseSchema,
  eventResponseSchema,
  expenseResourceProjectionResponseSchema,
  expenseResponseSchema,
  sectionListResponseSchema,
  sectionResponseSchema,
  taskResourceProjectionResponseSchema,
  taskResponseSchema,
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

const headers = (session: Awaited<ReturnType<typeof signIn>>) => ({
  authorization: `Bearer ${session.accessToken}`,
  "x-workspace-id": session.workspace.id,
});

describe("sections API", () => {
  it("creates between two sections, renames, moves, and deletes leaving the records loose", async () => {
    const owner = await signIn("sections@example.com", "Section Owner");
    const ownerHeaders = headers(owner);
    const event = eventResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/events",
          headers: ownerHeaders,
          payload: { displayName: "Launch" },
        })
      ).json(),
    );
    const createSection = async (payload: Record<string, unknown>) => {
      const response = await app.inject({
        method: "POST",
        url: `/api/events/${event.id}/sections`,
        headers: ownerHeaders,
        payload,
      });
      expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
      return sectionResponseSchema.parse(response.json());
    };
    const listNames = async (view: string) => {
      const response = await app.inject({
        method: "GET",
        url: `/api/events/${event.id}/sections?view=${view}`,
        headers: ownerHeaders,
      });
      expect(response.statusCode).toBe(200);
      return sectionListResponseSchema
        .parse(response.json())
        .items.map(({ name }) => name);
    };

    const before = await createSection({ view: "todos", name: "  Before  " });
    expect(before).toMatchObject({
      eventId: event.id,
      view: "todos",
      name: "Before",
      description: null,
    });
    const after = await createSection({
      view: "todos",
      name: "After",
      description: "Once the doors open",
    });
    const between = await createSection({
      view: "todos",
      name: "During",
      afterSectionId: before.id,
    });
    expect(between.rank > before.rank && between.rank < after.rank).toBe(true);
    expect(await listNames("todos")).toEqual(["Before", "During", "After"]);
    expect(await listNames("expenses")).toEqual([]);

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/sections/${between.id}`,
      headers: ownerHeaders,
      payload: { name: "Meanwhile", description: "" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(sectionResponseSchema.parse(renamed.json())).toMatchObject({
      name: "Meanwhile",
      description: null,
      rank: between.rank,
    });
    const moved = await app.inject({
      method: "PATCH",
      url: `/api/sections/${after.id}`,
      headers: ownerHeaders,
      payload: { afterSectionId: null },
    });
    expect(moved.statusCode).toBe(200);
    expect(await listNames("todos")).toEqual(["After", "Before", "Meanwhile"]);

    // A task placed by its section's add row, in the Event's context.
    const placed = await app.inject({
      method: "POST",
      url: `/api/events/${event.id}/resources`,
      headers: ownerHeaders,
      payload: {
        commandId: createId(),
        resource: {
          objectType: "task",
          displayName: "Confirm venue",
          sectionId: before.id,
        },
      },
    });
    expect(placed.statusCode, JSON.stringify(placed.json())).toBe(201);
    const task = taskResponseSchema.parse(
      eventContextCreateResponseSchema.parse(placed.json()).resource,
    );
    expect(task.sectionId).toBe(before.id);
    const todos = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/todos`,
      headers: ownerHeaders,
    });
    const projection = taskResourceProjectionResponseSchema.parse(todos.json());
    expect(projection.sections.map(({ name }) => name)).toEqual([
      "After",
      "Before",
      "Meanwhile",
    ]);
    expect(projection.items.map(({ sectionId }) => sectionId)).toEqual([
      before.id,
    ]);

    // Moving the task to another section is one PATCH with its rank.
    const dragged = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: ownerHeaders,
      payload: {
        expectedVersion: 1,
        sectionId: after.id,
        rank: "00000000500",
      },
    });
    expect(dragged.statusCode).toBe(200);
    expect(taskResponseSchema.parse(dragged.json())).toMatchObject({
      sectionId: after.id,
      rank: "00000000500",
      version: 2,
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/sections/${after.id}`,
      headers: ownerHeaders,
    });
    expect(deleted.statusCode).toBe(200);
    expect(sectionResponseSchema.parse(deleted.json()).id).toBe(after.id);
    expect(await listNames("todos")).toEqual(["Before", "Meanwhile"]);
    const loose = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}`,
      headers: ownerHeaders,
    });
    expect(taskResponseSchema.parse(loose.json())).toMatchObject({
      sectionId: null,
      version: 2,
    });
    const gone = await app.inject({
      method: "DELETE",
      url: `/api/sections/${after.id}`,
      headers: ownerHeaders,
    });
    expect(gone.statusCode).toBe(404);
  });

  it("refuses a section of another Event, of the other view, or on a standalone record", async () => {
    const owner = await signIn("sections-rules@example.com", "Section Owner");
    const ownerHeaders = headers(owner);
    const createEvent = async (displayName: string) =>
      eventResponseSchema.parse(
        (
          await app.inject({
            method: "POST",
            url: "/api/events",
            headers: ownerHeaders,
            payload: { displayName },
          })
        ).json(),
      );
    const trip = await createEvent("Trip");
    const other = await createEvent("Other");
    const section = async (eventId: string, view: string, name: string) =>
      sectionResponseSchema.parse(
        (
          await app.inject({
            method: "POST",
            url: `/api/events/${eventId}/sections`,
            headers: ownerHeaders,
            payload: { view, name },
          })
        ).json(),
      );
    const packing = await section(trip.id, "todos", "Packing");
    const transport = await section(trip.id, "expenses", "Transport");
    const elsewhere = await section(other.id, "todos", "Elsewhere");

    const expense = await app.inject({
      method: "POST",
      url: `/api/events/${trip.id}/resources`,
      headers: ownerHeaders,
      payload: {
        commandId: createId(),
        resource: {
          objectType: "expense",
          displayName: "Train",
          amount: "42",
          currency: "EUR",
          occurredAt: "2030-05-01T08:00:00.000Z",
          sectionId: transport.id,
        },
      },
    });
    expect(expense.statusCode, JSON.stringify(expense.json())).toBe(201);
    const fare = expenseResponseSchema.parse(
      eventContextCreateResponseSchema.parse(expense.json()).resource,
    );
    expect(fare.sectionId).toBe(transport.id);
    const expenses = expenseResourceProjectionResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/events/${trip.id}/expenses`,
          headers: ownerHeaders,
        })
      ).json(),
    );
    expect(expenses.sections.map(({ id }) => id)).toEqual([transport.id]);
    expect(expenses.items.map(({ sectionId }) => sectionId)).toEqual([
      transport.id,
    ]);

    for (const resource of [
      {
        objectType: "task",
        displayName: "Wrong event",
        sectionId: elsewhere.id,
      },
      {
        objectType: "task",
        displayName: "Wrong view",
        sectionId: transport.id,
      },
      {
        objectType: "expense",
        displayName: "Wrong view",
        amount: "1",
        currency: "EUR",
        occurredAt: "2030-05-01T08:00:00.000Z",
        sectionId: packing.id,
      },
    ]) {
      const refused = await app.inject({
        method: "POST",
        url: `/api/events/${trip.id}/resources`,
        headers: ownerHeaders,
        payload: { commandId: createId(), resource },
      });
      expect(refused.statusCode, JSON.stringify(resource)).toBe(400);
      expect(refused.json().error.message).toBe(
        "sectionId must name a section of this view of the record's Event.",
      );
    }
    const standalone = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: ownerHeaders,
      payload: { displayName: "Standalone", sectionId: packing.id },
    });
    expect(standalone.statusCode).toBe(400);
    const moved = await app.inject({
      method: "PATCH",
      url: `/api/expenses/${fare.id}`,
      headers: ownerHeaders,
      payload: { expectedVersion: 1, sectionId: packing.id },
    });
    expect(moved.statusCode).toBe(400);

    // Placement names a section of the same view.
    const misplaced = await app.inject({
      method: "POST",
      url: `/api/events/${trip.id}/sections`,
      headers: ownerHeaders,
      payload: {
        view: "todos",
        name: "Misplaced",
        afterSectionId: elsewhere.id,
      },
    });
    expect(misplaced.statusCode).toBe(400);
    const badView = await app.inject({
      method: "GET",
      url: `/api/events/${trip.id}/sections?view=notes`,
      headers: ownerHeaders,
    });
    expect(badView.statusCode).toBe(400);
    const empty = await app.inject({
      method: "PATCH",
      url: `/api/sections/${packing.id}`,
      headers: ownerHeaders,
      payload: {},
    });
    expect(empty.statusCode).toBe(400);

    // Another account sees none of it.
    const outsider = await signIn("outsider@example.com", "Outsider");
    const outsiderHeaders = {
      ...headers(outsider),
      "x-workspace-id": owner.workspace.id,
    };
    const listed = await app.inject({
      method: "GET",
      url: `/api/events/${trip.id}/sections?view=todos`,
      headers: outsiderHeaders,
    });
    expect(listed.statusCode).toBe(404);
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/sections/${packing.id}`,
      headers: outsiderHeaders,
      payload: { name: "Taken" },
    });
    expect(edited.statusCode).toBe(404);
  });
});
