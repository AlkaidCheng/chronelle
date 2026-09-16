import { resolve } from "node:path";

import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  developmentSignInResponseSchema,
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

describe("task duration", () => {
  it("keeps a duration with the due time, restores it, and refuses one without a time", async () => {
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
      payload: {
        displayName: "Walk the venue",
        dueAt: "2030-03-05T09:30:00Z",
        durationMinutes: 45,
      },
    });
    expect(created.statusCode).toBe(201);
    const task = taskResponseSchema.parse(created.json());
    expect(task.durationMinutes).toBe(45);

    // Clearing the time and the duration together is one change.
    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers,
      payload: { expectedVersion: 1, dueAt: null, durationMinutes: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(taskResponseSchema.parse(cleared.json())).toMatchObject({
      dueAt: null,
      durationMinutes: null,
    });

    // The duration is content: restoring the first revision brings it back
    // with its time.
    const restored = await app.inject({
      method: "POST",
      url: `/api/objects/${task.id}/revisions/1/restore`,
      headers,
      payload: { expectedVersion: 2 },
    });
    expect(restored.statusCode).toBe(200);
    expect(taskResponseSchema.parse(restored.json())).toMatchObject({
      dueAt: "2030-03-05T09:30:00.000Z",
      durationMinutes: 45,
      version: 3,
    });

    for (const payload of [
      { dueAt: null },
      { durationMinutes: 0 },
      { durationMinutes: 1441 },
      { durationMinutes: 30.5 },
    ]) {
      const refused = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${task.id}`,
        headers,
        payload: { expectedVersion: 3, ...payload },
      });
      expect(refused.statusCode).toBe(400);
    }
    const untimed = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers,
      payload: {
        displayName: "Untimed",
        dueOn: "2030-03-05",
        durationMinutes: 30,
      },
    });
    expect(untimed.statusCode).toBe(400);
  });
});
