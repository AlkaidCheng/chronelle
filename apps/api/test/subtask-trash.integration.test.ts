import { resolve } from "node:path";

import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import {
  developmentSignInResponseSchema,
  recoveryPreviewSchema,
  taskListResponseSchema,
  taskResponseSchema,
  trashListResponseSchema,
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

describe("subtasks in Trash", () => {
  it("trashes live subtasks with their parent and brings back the ones that went with it", async () => {
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
    const task = async (payload: Record<string, unknown>) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/tasks",
        headers,
        payload,
      });
      expect(response.statusCode).toBe(201);
      return taskResponseSchema.parse(response.json());
    };
    const parent = await task({ displayName: "Plan the trip" });
    const subtask = (displayName: string) =>
      task({
        displayName,
        parentTaskId: parent.id,
        permissionScopeId: parent.id,
      });
    const flights = await subtask("Book flights");
    const packing = await subtask("Pack");
    const dropped = await subtask("Dropped before");
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/objects/${dropped.id}?expectedVersion=1`,
          headers,
        })
      ).statusCode,
    ).toBe(200);

    // Trashing the parent takes its live subtasks along.
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/objects/${parent.id}?expectedVersion=1`,
      headers,
    });
    expect(deleted.statusCode).toBe(200);
    const open = taskListResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/api/tasks?filter=all",
          headers,
        })
      ).json(),
    );
    expect(open.items).toEqual([]);
    const trash = trashListResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/api/trash?limit=10",
          headers,
        })
      ).json(),
    );
    expect(new Set(trash.items.map(({ id }) => id))).toEqual(
      new Set([parent.id, flights.id, packing.id, dropped.id]),
    );

    // A subtask waits for its parent: the preview says so and recovery
    // refuses.
    const preview = recoveryPreviewSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/objects/${flights.id}/recovery-preview`,
          headers,
        })
      ).json(),
    );
    expect(preview).toMatchObject({
      canRecover: false,
      blockedReason:
        "Restore the canonical permission scope first. Recovery does not change permissions.",
    });
    const refused = await app.inject({
      method: "POST",
      url: `/api/objects/${flights.id}/recover`,
      headers,
      payload: { expectedVersion: 2 },
    });
    expect(refused.statusCode).toBe(400);

    // Recovering the parent brings back what went with it, not what was
    // trashed on its own.
    const recovered = await app.inject({
      method: "POST",
      url: `/api/objects/${parent.id}/recover`,
      headers,
      payload: { expectedVersion: 2 },
    });
    expect(recovered.statusCode).toBe(200);
    const after = taskListResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/api/tasks?filter=all&sort=name",
          headers,
        })
      ).json(),
    );
    expect(after.items.map(({ id, version }) => [id, version])).toEqual([
      [flights.id, 3],
      [packing.id, 3],
      [parent.id, 3],
    ]);
    expect(after.progress[parent.id]).toEqual({ done: 0, total: 2 });
    const remaining = trashListResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/api/trash?limit=10",
          headers,
        })
      ).json(),
    );
    expect(remaining.items.map(({ id }) => id)).toEqual([dropped.id]);
  });
});
