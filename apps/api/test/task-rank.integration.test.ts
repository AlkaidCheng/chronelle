import { resolve } from "node:path";

import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import {
  developmentSignInResponseSchema,
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

describe("task rank", () => {
  it("ranks new tasks last, moves one between two others, and lists in manual order", async () => {
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
    const create = async (displayName: string, rank?: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/tasks",
        headers,
        payload: { displayName, ...(rank === undefined ? {} : { rank }) },
      });
      expect(response.statusCode).toBe(201);
      return taskResponseSchema.parse(response.json());
    };
    const first = await create("Book the venue");
    const second = await create("Order the flowers");
    const third = await create("Print the programme");
    expect([first.rank, second.rank, third.rank]).toEqual([
      "00000001000",
      "00000002000",
      "00000003000",
    ]);

    // Dropping the third between the first two takes their midpoint and
    // moves nobody else; the move is a versioned update like any edit.
    const moved = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${third.id}`,
      headers,
      payload: { expectedVersion: 1, rank: "00000001500" },
    });
    expect(moved.statusCode).toBe(200);
    expect(taskResponseSchema.parse(moved.json())).toMatchObject({
      rank: "00000001500",
      version: 2,
    });
    const listed = await app.inject({
      method: "GET",
      url: "/api/tasks?sort=manual&limit=2",
      headers,
    });
    expect(listed.statusCode).toBe(200);
    const page = taskListResponseSchema.parse(listed.json());
    expect(page.items.map((task) => task.displayName)).toEqual([
      "Book the venue",
      "Print the programme",
    ]);
    expect(page.nextCursor).not.toBeNull();
    const rest = await app.inject({
      method: "GET",
      url: `/api/tasks?sort=manual&limit=2&cursor=${encodeURIComponent(page.nextCursor ?? "")}`,
      headers,
    });
    expect(
      taskListResponseSchema
        .parse(rest.json())
        .items.map((task) => task.displayName),
    ).toEqual(["Order the flowers"]);

    // The next task goes a thousand past the highest integer part in use.
    const fourth = await create("Send thank-you notes");
    expect(fourth.rank).toBe("00000003000");

    for (const payload of [{ rank: "1500" }, { rank: "00000001500.50" }]) {
      const refused = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${first.id}`,
        headers,
        payload: { expectedVersion: 1, ...payload },
      });
      expect(refused.statusCode).toBe(400);
    }
    // A rank is never restored from history: restoring version 1 of the
    // moved task keeps its current place.
    const restored = await app.inject({
      method: "POST",
      url: `/api/objects/${third.id}/revisions/1/restore`,
      headers,
      payload: { expectedVersion: 2 },
    });
    expect(restored.statusCode).toBe(400);
  });
});
