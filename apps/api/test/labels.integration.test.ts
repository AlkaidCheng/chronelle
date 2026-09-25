import { resolve } from "node:path";

import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import {
  developmentSignInResponseSchema,
  labelListResponseSchema,
  labelResponseSchema,
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

const headers = (session: Awaited<ReturnType<typeof signIn>>) => ({
  authorization: `Bearer ${session.accessToken}`,
  "x-workspace-id": session.workspace.id,
});

describe("labels API", () => {
  it("creates, renames, assigns, filters by, and deletes workspace labels", async () => {
    const owner = await signIn("labels@example.com", "Label Owner");
    const ownerHeaders = headers(owner);

    const created = await app.inject({
      method: "POST",
      url: "/api/labels",
      headers: ownerHeaders,
      payload: { name: "  Venue  " },
    });
    expect(created.statusCode).toBe(201);
    const venue = labelResponseSchema.parse(created.json());
    expect(venue).toMatchObject({ name: "Venue", version: 1 });
    const urgent = labelResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/labels",
          headers: ownerHeaders,
          payload: { name: "urgent" },
        })
      ).json(),
    );

    // Names are unique per workspace, case-insensitively.
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/labels",
      headers: ownerHeaders,
      payload: { name: "VENUE" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({
      error: { code: "label_name_taken" },
    });
    const blank = await app.inject({
      method: "POST",
      url: "/api/labels",
      headers: ownerHeaders,
      payload: { name: "   " },
    });
    expect(blank.statusCode).toBe(400);

    const listed = labelListResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/api/labels",
          headers: ownerHeaders,
        })
      ).json(),
    );
    expect(listed.items.map(({ name }) => name)).toEqual(["urgent", "Venue"]);

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/labels/${venue.id}`,
      headers: ownerHeaders,
      payload: { expectedVersion: 1, name: "Venues" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(labelResponseSchema.parse(renamed.json())).toMatchObject({
      name: "Venues",
      version: 2,
    });
    const stale = await app.inject({
      method: "PATCH",
      url: `/api/labels/${venue.id}`,
      headers: ownerHeaders,
      payload: { expectedVersion: 1, name: "Places" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: "version_conflict" } });

    // A task carries labels as a whole, in name order.
    const taskResponse = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: ownerHeaders,
      payload: {
        displayName: "Book the hall",
        labelIds: [venue.id, urgent.id],
      },
    });
    expect(taskResponse.statusCode).toBe(201);
    const task = taskResponseSchema.parse(taskResponse.json());
    expect(task.labelIds).toEqual([urgent.id, venue.id]);
    const unknownLabel = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: ownerHeaders,
      payload: {
        expectedVersion: 1,
        labelIds: ["00000000-0000-4000-8000-000000000000"],
      },
    });
    expect(unknownLabel.statusCode).toBe(400);
    expect(unknownLabel.json()).toMatchObject({
      error: { message: "labelIds must name labels of this workspace." },
    });
    const other = taskResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/tasks",
          headers: ownerHeaders,
          payload: { displayName: "Send thanks" },
        })
      ).json(),
    );
    const byLabel = taskListResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/tasks?label=${venue.id}`,
          headers: ownerHeaders,
        })
      ).json(),
    );
    expect(byLabel.items.map(({ id }) => id)).toEqual([task.id]);
    expect(byLabel.items[0]?.labelIds).toEqual([urgent.id, venue.id]);

    // Deleting a label removes it from its tasks.
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/labels/${urgent.id}?expectedVersion=1`,
      headers: ownerHeaders,
    });
    expect(deleted.statusCode).toBe(200);
    const after = taskResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/tasks/${task.id}`,
          headers: ownerHeaders,
        })
      ).json(),
    );
    expect(after.labelIds).toEqual([venue.id]);
    expect(other.labelIds).toEqual([]);

    // A stranger can neither list nor create labels in this workspace.
    const stranger = await signIn("stranger@example.com", "Stranger");
    const strangerList = await app.inject({
      method: "GET",
      url: "/api/labels",
      headers: {
        authorization: `Bearer ${stranger.accessToken}`,
        "x-workspace-id": owner.workspace.id,
      },
    });
    expect(strangerList.statusCode).toBe(404);
  });
});
