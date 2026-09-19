import { resolve } from "node:path";

import { createId } from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  developmentSignInResponseSchema,
  eventResponseSchema,
  taskResponseSchema,
} from "@chronelle/schemas";
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

describe("descriptions", () => {
  it("keeps an event's description with its line breaks, reads an empty one as none, clears and restores it, and refuses a long one", async () => {
    const signedIn = await app.inject({
      method: "POST",
      url: "/api/auth/development/sign-in",
      payload: { email: "owner@example.com", displayName: "Zoe Owner" },
    });
    const owner = developmentSignInResponseSchema.parse(signedIn.json());
    const headers = {
      authorization: `Bearer ${owner.accessToken}`,
      "x-workspace-id": owner.workspace.id,
    };
    const created = await app.inject({
      method: "POST",
      url: "/api/events",
      headers,
      payload: {
        displayName: "Kyoto in November",
        startsOn: "2030-11-02",
        endsOn: "2030-11-06",
        isAllDay: true,
        description:
          "  Five days in Kyoto.\nDinner with the Tanakas on the second.  ",
      },
    });
    expect(created.statusCode).toBe(201);
    const event = eventResponseSchema.parse(created.json());
    expect(event.description).toBe(
      "Five days in Kyoto.\nDinner with the Tanakas on the second.",
    );

    // An empty description is none; the field is content, so the first
    // revision restores it.
    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/events/${event.id}`,
      headers,
      payload: { expectedVersion: 1, description: "" },
    });
    expect(cleared.statusCode).toBe(200);
    expect(eventResponseSchema.parse(cleared.json()).description).toBeNull();
    const restored = await app.inject({
      method: "POST",
      url: `/api/objects/${event.id}/revisions/1/restore`,
      headers,
      payload: { expectedVersion: 2 },
    });
    expect(restored.statusCode).toBe(200);
    expect(eventResponseSchema.parse(restored.json())).toMatchObject({
      description:
        "Five days in Kyoto.\nDinner with the Tanakas on the second.",
      version: 3,
    });

    const refused = await app.inject({
      method: "PATCH",
      url: `/api/events/${event.id}`,
      headers,
      payload: { expectedVersion: 3, description: "x".repeat(2001) },
    });
    expect(refused.statusCode).toBe(400);
  });

  it("keeps a task's description inside an event and clears it", async () => {
    const signedIn = await app.inject({
      method: "POST",
      url: "/api/auth/development/sign-in",
      payload: { email: "owner@example.com", displayName: "Zoe Owner" },
    });
    const owner = developmentSignInResponseSchema.parse(signedIn.json());
    const headers = {
      authorization: `Bearer ${owner.accessToken}`,
      "x-workspace-id": owner.workspace.id,
    };
    const trip = await app.inject({
      method: "POST",
      url: "/api/events",
      headers,
      payload: { displayName: "Kyoto in November", startsOn: "2030-11-03" },
    });
    const tripId = eventResponseSchema.parse(trip.json()).id;
    const created = await app.inject({
      method: "POST",
      url: `/api/events/${tripId}/resources`,
      headers,
      payload: {
        commandId: createId(),
        resource: {
          objectType: "task",
          displayName: "Book the bamboo tickets",
          description: "Eight so far; the Tanakas may bring one more.",
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const task = taskResponseSchema.parse(created.json().resource);
    expect(task.description).toBe(
      "Eight so far; the Tanakas may bring one more.",
    );
    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers,
      payload: { expectedVersion: 1, description: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(taskResponseSchema.parse(cleared.json()).description).toBeNull();
    const fetched = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}`,
      headers,
    });
    expect(taskResponseSchema.parse(fetched.json()).description).toBeNull();
  });
});
