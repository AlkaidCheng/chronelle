import { resolve } from "node:path";

import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  developmentSignInResponseSchema,
  personResponseSchema,
  taskListResponseSchema,
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

describe("standalone creation commands", () => {
  it("creates once per command, replays the object, and refuses a changed input", async () => {
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
    const commandId = "00000000-0000-4000-8000-000000000042";
    const payload = { displayName: "Renew the passport", commandId };
    const first = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers,
      payload,
    });
    expect(first.statusCode).toBe(201);
    const task = taskResponseSchema.parse(first.json());
    const again = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers,
      payload,
    });
    expect(again.statusCode).toBe(201);
    expect(taskResponseSchema.parse(again.json())).toEqual(task);
    const listed = taskListResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/api/tasks",
          headers,
        })
      ).json(),
    );
    expect(listed.items.map(({ id }) => id)).toEqual([task.id]);

    const changed = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers,
      payload: { displayName: "Renew the passport, soon", commandId },
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({
      error: { code: "command_conflict" },
    });

    // A command id belongs to the caller, not to a family: reusing the
    // task's id for a person is a conflict, and a person's own command
    // replays the person.
    const crossed = await app.inject({
      method: "POST",
      url: "/api/persons",
      headers,
      payload: { displayName: "Mira", commandId },
    });
    expect(crossed.statusCode).toBe(409);
    const personPayload = {
      displayName: "Mira",
      commandId: "00000000-0000-4000-8000-000000000043",
    };
    const person = personResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/persons",
          headers,
          payload: personPayload,
        })
      ).json(),
    );
    expect(person.objectType).toBe("person");
    const personAgain = await app.inject({
      method: "POST",
      url: "/api/persons",
      headers,
      payload: personPayload,
    });
    expect(personResponseSchema.parse(personAgain.json()).id).toBe(person.id);
  });
});
