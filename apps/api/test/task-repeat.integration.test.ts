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

describe("task repeat", () => {
  it("advances the due on completion, keeps history, and refuses a rule without a due", async () => {
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
        displayName: "Water the plants",
        dueOn: "2030-03-05",
        repeatRule: "weekly",
        repeatUntil: "2030-03-12",
      },
    });
    expect(created.statusCode).toBe(201);
    const task = taskResponseSchema.parse(created.json());
    expect(task).toMatchObject({
      repeatRule: "weekly",
      repeatUntil: "2030-03-12",
    });

    // Completing moves the due a week on and keeps the task open; the
    // completion is one versioned update whose revision shows the move.
    const completed = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers,
      payload: {
        expectedVersion: 1,
        status: "done",
        completedAt: "2030-03-05T18:00:00Z",
      },
    });
    expect(completed.statusCode).toBe(200);
    expect(taskResponseSchema.parse(completed.json())).toMatchObject({
      status: "todo",
      dueOn: "2030-03-12",
      completedAt: null,
      version: 2,
    });
    const revisions = await app.inject({
      method: "GET",
      url: `/api/objects/${task.id}/revisions`,
      headers,
    });
    expect(revisions.statusCode).toBe(200);
    expect(
      (revisions.json() as { items: { objectVersion: number }[] }).items.map(
        (item) => item.objectVersion,
      ),
    ).toEqual(expect.arrayContaining([1, 2]));

    // The next occurrence would pass the end, so the last completion is final.
    const last = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers,
      payload: {
        expectedVersion: 2,
        status: "done",
        completedAt: "2030-03-12T18:00:00Z",
      },
    });
    expect(last.statusCode).toBe(200);
    expect(taskResponseSchema.parse(last.json())).toMatchObject({
      status: "done",
      dueOn: "2030-03-12",
      completedAt: "2030-03-12T18:00:00.000Z",
    });

    // Restoring the first revision brings the first occurrence back.
    const restored = await app.inject({
      method: "POST",
      url: `/api/objects/${task.id}/revisions/1/restore`,
      headers,
      payload: { expectedVersion: 3 },
    });
    expect(restored.statusCode).toBe(200);
    expect(taskResponseSchema.parse(restored.json())).toMatchObject({
      status: "todo",
      dueOn: "2030-03-05",
      repeatRule: "weekly",
      version: 4,
    });

    for (const payload of [
      { dueOn: null },
      { repeatRule: "hourly" },
      { repeatUntil: "2030-03-04" },
    ]) {
      const refused = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${task.id}`,
        headers,
        payload: { expectedVersion: 4, ...payload },
      });
      expect(refused.statusCode).toBe(400);
    }
    // Clearing the rule clears its end; an end alone is then refused.
    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers,
      payload: { expectedVersion: 4, repeatRule: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(taskResponseSchema.parse(cleared.json())).toMatchObject({
      repeatRule: null,
      repeatUntil: null,
    });
    const ended = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers,
      payload: { expectedVersion: 5, repeatUntil: "2030-04-01" },
    });
    expect(ended.statusCode).toBe(400);
    const undated = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers,
      payload: { displayName: "Undated", repeatRule: "daily" },
    });
    expect(undated.statusCode).toBe(400);
  });
});
