import { resolve } from "node:path";

import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import {
  developmentSignInResponseSchema,
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

describe("task location", () => {
  it("keeps a trimmed location, clears it, restores it, and refuses a long one", async () => {
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
      url: "/api/tasks",
      headers,
      payload: { displayName: "Book the hall", location: "  Sunset Hall  " },
    });
    expect(created.statusCode).toBe(201);
    const task = taskResponseSchema.parse(created.json());
    expect(task.location).toBe("Sunset Hall");

    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers,
      payload: { expectedVersion: 1, location: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(taskResponseSchema.parse(cleared.json()).location).toBeNull();

    // The location is content: restoring the first revision brings it back.
    const restored = await app.inject({
      method: "POST",
      url: `/api/objects/${task.id}/revisions/1/restore`,
      headers,
      payload: { expectedVersion: 2 },
    });
    expect(restored.statusCode).toBe(200);
    expect(taskResponseSchema.parse(restored.json())).toMatchObject({
      location: "Sunset Hall",
      version: 3,
    });

    for (const location of ["", "x".repeat(241)]) {
      const refused = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${task.id}`,
        headers,
        payload: { expectedVersion: 3, location },
      });
      expect(refused.statusCode).toBe(400);
    }
  });
});
