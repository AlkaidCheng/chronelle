import { resolve } from "node:path";

import { resourceGrants } from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  developmentSignInResponseSchema,
  eventContextCreateResponseSchema,
  eventResponseSchema,
  noteListResponseSchema,
  noteResponseSchema,
  objectSearchResponseSchema,
  revisionListResponseSchema,
  trashListResponseSchema,
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

async function signIn(email: string, displayName: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/development/sign-in",
    payload: { email, displayName },
  });
  expect(response.statusCode).toBe(200);
  return developmentSignInResponseSchema.parse(response.json());
}

const headers = (
  session: Awaited<ReturnType<typeof signIn>>,
  workspaceId = session.workspace.id,
) => ({
  authorization: `Bearer ${session.accessToken}`,
  "x-workspace-id": workspaceId,
});

describe("notes API", () => {
  it("keeps notes with an event: create, list, edit, history, trash, restore, search", async () => {
    const owner = await signIn("owner@example.com", "Mei Lin");
    const editor = await signIn("editor@example.com", "Sam Reader");
    const stranger = await signIn("stranger@example.com", "Stranger");
    const ownerHeaders = headers(owner);
    const event = eventResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/events",
          headers: ownerHeaders,
          payload: { displayName: "Kyoto in November" },
        })
      ).json(),
    );
    await testDatabase.connection.db.insert(resourceGrants).values({
      id: "019d6e7d-0000-7000-8000-000000000001",
      workspaceId: owner.workspace.id,
      resourceId: event.id,
      principalId: editor.user.id,
      role: "editor",
      grantedBy: owner.user.id,
    });

    // A note is created inside the event like any other record; the body
    // keeps its line breaks and may be empty.
    const created = await app.inject({
      method: "POST",
      url: `/api/events/${event.id}/resources`,
      headers: ownerHeaders,
      payload: {
        commandId: "00000000-0000-4000-8000-000000000001",
        resource: {
          objectType: "note",
          displayName: "Where we eat",
          body: "Kikunoi on Tuesday.\nAsk for the counter.",
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const eating = eventContextCreateResponseSchema.parse(created.json());
    expect(eating.resource).toMatchObject({
      objectType: "note",
      displayName: "Where we eat",
      body: "Kikunoi on Tuesday.\nAsk for the counter.",
      permissionScopeId: event.id,
      version: 1,
    });
    const packing = eventContextCreateResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: `/api/events/${event.id}/resources`,
          headers: headers(editor, owner.workspace.id),
          payload: {
            commandId: "00000000-0000-4000-8000-000000000002",
            resource: { objectType: "note", displayName: "Packing" },
          },
        })
      ).json(),
    ).resource;
    expect(packing).toMatchObject({ objectType: "note", body: "" });

    // The list names who wrote each note's current version, newest edit
    // first; by title on request. A stranger cannot list them.
    const listed = noteListResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/events/${event.id}/notes`,
          headers: ownerHeaders,
        })
      ).json(),
    );
    expect(listed.sourceEventId).toBe(event.id);
    expect(
      listed.items.map(({ displayName, editedBy }) => [displayName, editedBy]),
    ).toEqual([
      ["Packing", "Sam Reader"],
      ["Where we eat", "Mei Lin"],
    ]);
    const byTitle = noteListResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/events/${event.id}/notes?sort=title`,
          headers: ownerHeaders,
        })
      ).json(),
    );
    expect(byTitle.items.map(({ displayName }) => displayName)).toEqual([
      "Packing",
      "Where we eat",
    ]);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/events/${event.id}/notes?sort=recent`,
          headers: ownerHeaders,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/events/${event.id}/notes`,
          headers: headers(stranger, owner.workspace.id),
        })
      ).statusCode,
    ).toBe(404);

    // An edit records a version; a stale one is a conflict; the text is
    // bounded.
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/notes/${eating.resource.id}`,
      headers: headers(editor, owner.workspace.id),
      payload: { expectedVersion: 1, body: "Kikunoi on Wednesday." },
    });
    expect(edited.statusCode).toBe(200);
    expect(noteResponseSchema.parse(edited.json())).toMatchObject({
      body: "Kikunoi on Wednesday.",
      version: 2,
    });
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/notes/${eating.resource.id}`,
          headers: ownerHeaders,
          payload: { expectedVersion: 1, displayName: "Stale" },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/notes/${eating.resource.id}`,
          headers: ownerHeaders,
          payload: { expectedVersion: 2, body: "x".repeat(20_001) },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      noteListResponseSchema
        .parse(
          (
            await app.inject({
              method: "GET",
              url: `/api/events/${event.id}/notes`,
              headers: ownerHeaders,
            })
          ).json(),
        )
        .items.map(({ displayName, editedBy }) => [displayName, editedBy]),
    ).toEqual([
      ["Where we eat", "Sam Reader"],
      ["Packing", "Sam Reader"],
    ]);
    expect(
      noteResponseSchema.parse(
        (
          await app.inject({
            method: "GET",
            url: `/api/notes/${eating.resource.id}`,
            headers: ownerHeaders,
          })
        ).json(),
      ).body,
    ).toBe("Kikunoi on Wednesday.");

    // History shows the text change; restoring the first version brings
    // the first text back as a third version.
    const history = revisionListResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/objects/${eating.resource.id}/revisions?limit=1`,
          headers: ownerHeaders,
        })
      ).json(),
    );
    expect(history.items[0]).toMatchObject({
      objectVersion: 2,
      actorDisplayName: "Sam Reader",
      changedFields: [
        {
          field: "body",
          label: "Text",
          before: "Kikunoi on Tuesday.\nAsk for the counter.",
          after: "Kikunoi on Wednesday.",
        },
      ],
    });
    const restored = await app.inject({
      method: "POST",
      url: `/api/objects/${eating.resource.id}/revisions/1/restore`,
      headers: ownerHeaders,
      payload: { expectedVersion: 2 },
    });
    expect(restored.statusCode).toBe(200);
    expect(noteResponseSchema.parse(restored.json())).toMatchObject({
      body: "Kikunoi on Tuesday.\nAsk for the counter.",
      version: 3,
    });

    // Search finds a note by its title only.
    const found = objectSearchResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/api/search?query=packing&objectType=note",
          headers: ownerHeaders,
        })
      ).json(),
    );
    expect(found.items.map(({ id }) => id)).toEqual([packing.id]);
    expect(
      objectSearchResponseSchema.parse(
        (
          await app.inject({
            method: "GET",
            url: "/api/search?query=kikunoi",
            headers: ownerHeaders,
          })
        ).json(),
      ).items,
    ).toEqual([]);

    // Trash takes a note out of the list and Trash lists it; recovery
    // brings it back.
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/objects/${packing.id}?expectedVersion=1`,
      headers: ownerHeaders,
    });
    expect(deleted.statusCode).toBe(200);
    expect(
      noteListResponseSchema
        .parse(
          (
            await app.inject({
              method: "GET",
              url: `/api/events/${event.id}/notes`,
              headers: ownerHeaders,
            })
          ).json(),
        )
        .items.map(({ id }) => id),
    ).toEqual([eating.resource.id]);
    const trash = trashListResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/api/trash?objectType=note",
          headers: ownerHeaders,
        })
      ).json(),
    );
    expect(trash.items.map(({ id }) => id)).toEqual([packing.id]);
    const recovered = await app.inject({
      method: "POST",
      url: `/api/objects/${packing.id}/recover`,
      headers: ownerHeaders,
      payload: { expectedVersion: 2 },
    });
    expect(recovered.statusCode).toBe(200);
    expect(
      noteListResponseSchema.parse(
        (
          await app.inject({
            method: "GET",
            url: `/api/events/${event.id}/notes`,
            headers: ownerHeaders,
          })
        ).json(),
      ).items,
    ).toHaveLength(2);

    // A standalone note needs a title; the body is optional and bounded.
    const standalone = await app.inject({
      method: "POST",
      url: "/api/notes",
      headers: ownerHeaders,
      payload: { displayName: "Loose thought", body: "Later." },
    });
    expect(standalone.statusCode).toBe(201);
    expect(noteResponseSchema.parse(standalone.json())).toMatchObject({
      objectType: "note",
      body: "Later.",
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/notes",
          headers: ownerHeaders,
          payload: { displayName: "", body: "No title" },
        })
      ).statusCode,
    ).toBe(400);
  });
});
