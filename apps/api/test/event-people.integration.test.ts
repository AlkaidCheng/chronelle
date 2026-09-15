import { resolve } from "node:path";

import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  developmentSignInResponseSchema,
  eventContextCreateResponseSchema,
  eventDetailResponseSchema,
  eventResponseSchema,
  personResourceProjectionResponseSchema,
  personResponseSchema,
  relationResponseSchema,
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

describe("people in an event", () => {
  it("includes known and new people, lists them by name, and removes one", async () => {
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
    const event = eventResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/events",
          headers,
          payload: { displayName: "Launch night" },
        })
      ).json(),
    );
    const zoe = personResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/persons",
          headers,
          payload: { displayName: "Zoe" },
        })
      ).json(),
    );

    // A known person joins through an includes relation; a new one is
    // created inside the event in one command.
    const included = await app.inject({
      method: "POST",
      url: `/api/objects/${event.id}/relations`,
      headers,
      payload: { relationType: "includes", targetObjectId: zoe.id },
    });
    expect(included.statusCode).toBe(201);
    const link = relationResponseSchema.parse(included.json());
    const created = await app.inject({
      method: "POST",
      url: `/api/events/${event.id}/resources`,
      headers,
      payload: {
        commandId: "00000000-0000-4000-8000-000000000001",
        resource: { objectType: "person", displayName: "adam" },
      },
    });
    expect(created.statusCode).toBe(201);
    const adam = eventContextCreateResponseSchema.parse(created.json());
    expect(adam.resource).toMatchObject({
      objectType: "person",
      displayName: "adam",
      permissionScopeId: event.id,
    });

    const people = personResourceProjectionResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/events/${event.id}/people`,
          headers,
        })
      ).json(),
    );
    expect(people.sourceEventId).toBe(event.id);
    expect(people.items.map(({ displayName }) => displayName)).toEqual([
      "adam",
      "Zoe",
    ]);
    const detail = eventDetailResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/events/${event.id}/detail`,
          headers,
        })
      ).json(),
    );
    expect(detail.persons.map(({ id }) => id)).toEqual([
      adam.resource.id,
      zoe.id,
    ]);

    // Removing the link leaves the person in the workspace.
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/relations/${link.id}?expectedVersion=${link.version}`,
      headers,
    });
    expect(removed.statusCode).toBe(200);
    const after = personResourceProjectionResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/events/${event.id}/people`,
          headers,
        })
      ).json(),
    );
    expect(after.items.map(({ id }) => id)).toEqual([adam.resource.id]);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/persons/${zoe.id}`,
          headers,
        })
      ).statusCode,
    ).toBe(200);

    // Only an Event includes people.
    const fromPerson = await app.inject({
      method: "POST",
      url: `/api/objects/${zoe.id}/relations`,
      headers,
      payload: { relationType: "includes", targetObjectId: adam.resource.id },
    });
    expect(fromPerson.statusCode).toBe(400);
  });
});
