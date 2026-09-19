import { resolve } from "node:path";

import { createId } from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  developmentSignInResponseSchema,
  eventResourceProjectionResponseSchema,
  eventResponseSchema,
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

describe("event location", () => {
  it("keeps a trimmed location on a schedule item, shows it on the itinerary, clears and restores it, and refuses a long one", async () => {
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
    expect(trip.statusCode).toBe(201);
    const tripId = eventResponseSchema.parse(trip.json()).id;
    const created = await app.inject({
      method: "POST",
      url: `/api/events/${tripId}/resources`,
      headers,
      payload: {
        commandId: createId(),
        resource: {
          objectType: "event",
          displayName: "Fushimi Inari, the lower loop",
          startsAt: "2030-11-03T00:30:00.000Z",
          endsAt: "2030-11-03T02:30:00.000Z",
          location: "  Fushimi Inari Taisha, main gate  ",
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const item = eventResponseSchema.parse(created.json().resource);
    expect(item.location).toBe("Fushimi Inari Taisha, main gate");

    const itinerary = await app.inject({
      method: "GET",
      url: `/api/events/${tripId}/itinerary`,
      headers,
    });
    expect(itinerary.statusCode).toBe(200);
    expect(
      eventResourceProjectionResponseSchema
        .parse(itinerary.json())
        .items.map((row) => row.location),
    ).toEqual(["Fushimi Inari Taisha, main gate"]);

    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/events/${item.id}`,
      headers,
      payload: { expectedVersion: 1, location: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(eventResponseSchema.parse(cleared.json()).location).toBeNull();

    // The location is content: restoring the first revision brings it back.
    const restored = await app.inject({
      method: "POST",
      url: `/api/objects/${item.id}/revisions/1/restore`,
      headers,
      payload: { expectedVersion: 2 },
    });
    expect(restored.statusCode).toBe(200);
    expect(eventResponseSchema.parse(restored.json())).toMatchObject({
      location: "Fushimi Inari Taisha, main gate",
      version: 3,
    });

    for (const location of ["", "x".repeat(241)]) {
      const refused = await app.inject({
        method: "PATCH",
        url: `/api/events/${item.id}`,
        headers,
        payload: { expectedVersion: 3, location },
      });
      expect(refused.statusCode).toBe(400);
    }
  });
});
