import { resolve } from "node:path";

import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import {
  developmentSignInResponseSchema,
  personResponseSchema,
  taskListResponseSchema,
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

describe("task assignment", () => {
  it("assigns tasks to live people, filters by assignee, and refuses others", async () => {
    const owner = await signIn("owner@example.com", "Zoe Owner");
    const headers = {
      authorization: `Bearer ${owner.accessToken}`,
      "x-workspace-id": owner.workspace.id,
    };
    const person = async (displayName: string) =>
      personResponseSchema.parse(
        (
          await app.inject({
            method: "POST",
            url: "/api/persons",
            headers,
            payload: { displayName },
          })
        ).json(),
      );
    const mira = await person("Mira");
    const sam = await person("Sam");
    const former = await person("Former");
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/objects/${former.id}?expectedVersion=1`,
          headers,
        })
      ).statusCode,
    ).toBe(200);

    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers,
      payload: { displayName: "Book the hall", assigneeId: mira.id },
    });
    expect(created.statusCode).toBe(201);
    const task = taskResponseSchema.parse(created.json());
    expect(task.assigneeId).toBe(mira.id);
    const unassigned = taskResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/tasks",
          headers,
          payload: { displayName: "Send thanks" },
        })
      ).json(),
    );
    expect(unassigned.assigneeId).toBeNull();
    const byAssignee = taskListResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/tasks?assignee=${mira.id}`,
          headers,
        })
      ).json(),
    );
    expect(byAssignee.items.map(({ id }) => id)).toEqual([task.id]);

    const reassigned = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers,
      payload: { expectedVersion: 1, assigneeId: sam.id },
    });
    expect(reassigned.statusCode).toBe(200);
    expect(taskResponseSchema.parse(reassigned.json()).assigneeId).toBe(sam.id);
    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers,
      payload: { expectedVersion: 2, assigneeId: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(taskResponseSchema.parse(cleared.json()).assigneeId).toBeNull();

    // A trashed person, a task, and an unknown id are refused alike.
    for (const assigneeId of [
      former.id,
      unassigned.id,
      "00000000-0000-4000-8000-000000000000",
    ]) {
      const refused = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${task.id}`,
        headers,
        payload: { expectedVersion: 3, assigneeId },
      });
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toMatchObject({
        error: {
          message: "assigneeId must name a live person in this workspace.",
        },
      });
    }
  });
});
