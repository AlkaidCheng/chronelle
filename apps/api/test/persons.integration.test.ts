import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { workspaceMembers } from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  developmentSignInResponseSchema,
  labelResponseSchema,
  objectSearchResponseSchema,
  personListResponseSchema,
  personResponseSchema,
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

describe("persons API", () => {
  it("creates, lists, links, edits, searches, trashes, and restores people", async () => {
    const owner = await signIn("owner@example.com", "Zoe Owner");
    const editor = await signIn("editor@example.com", "Adam Editor");
    const stranger = await signIn("stranger@example.com", "Stranger");
    const ownerHeaders = headers(owner);
    await testDatabase.connection.db.insert(workspaceMembers).values({
      workspaceId: owner.workspace.id,
      userId: editor.user.id,
      role: "editor",
    });

    // A person needs only a name; contacts and a linked account are optional.
    const created = await app.inject({
      method: "POST",
      url: "/api/persons",
      headers: ownerHeaders,
      payload: { displayName: "Mira" },
    });
    expect(created.statusCode).toBe(201);
    const mira = personResponseSchema.parse(created.json());
    expect(mira).toMatchObject({
      objectType: "person",
      displayName: "Mira",
      contacts: [],
      userId: null,
      version: 1,
    });
    const samResponse = await app.inject({
      method: "POST",
      url: "/api/persons",
      headers: ownerHeaders,
      payload: {
        displayName: "sam lee",
        contacts: [{ kind: "email", value: " sam@example.test " }],
        userId: editor.user.id,
        customProperties: { phone: "+1 555 0100" },
      },
    });
    expect(samResponse.statusCode).toBe(201);
    const sam = personResponseSchema.parse(samResponse.json());
    expect(sam.contacts).toEqual([
      { kind: "email", value: "sam@example.test" },
    ]);
    expect(sam.userId).toBe(editor.user.id);

    // The list comes in case-insensitive name order and narrows by query.
    const listed = personListResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/api/persons",
          headers: ownerHeaders,
        })
      ).json(),
    );
    expect(listed.items.map(({ displayName }) => displayName)).toEqual([
      "Mira",
      "sam lee",
    ]);
    const queried = personListResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/api/persons?query=SAM&limit=1",
          headers: ownerHeaders,
        })
      ).json(),
    );
    expect(queried.items.map(({ id }) => id)).toEqual([sam.id]);
    expect(
      personResponseSchema.parse(
        (
          await app.inject({
            method: "GET",
            url: `/api/persons/${mira.id}`,
            headers: ownerHeaders,
          })
        ).json(),
      ).id,
    ).toBe(mira.id);

    // Only members can be linked, and each account belongs to one person.
    for (const [payload, message] of [
      [
        { expectedVersion: 1, userId: stranger.user.id },
        "userId must name a member of this workspace or a friend of one.",
      ],
      [
        { expectedVersion: 1, userId: editor.user.id },
        "userId is already linked to another person.",
      ],
    ] as const) {
      const refused = await app.inject({
        method: "PATCH",
        url: `/api/persons/${mira.id}`,
        headers: ownerHeaders,
        payload,
      });
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toMatchObject({ error: { message } });
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/persons",
          headers: ownerHeaders,
          payload: {
            displayName: "x",
            contacts: [{ kind: "email", value: "not-an-address" }],
          },
        })
      ).statusCode,
    ).toBe(400);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/persons/${mira.id}`,
      headers: ownerHeaders,
      payload: {
        expectedVersion: 1,
        displayName: "Mira Chen",
        contacts: [{ kind: "email", value: "mira@example.test" }],
        userId: owner.user.id,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(personResponseSchema.parse(updated.json())).toMatchObject({
      displayName: "Mira Chen",
      contacts: [{ kind: "email", value: "mira@example.test" }],
      userId: owner.user.id,
      version: 2,
    });

    // Search finds people by name; a stranger sees none of the workspace.
    const found = objectSearchResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/api/search?query=mira&objectType=person",
          headers: ownerHeaders,
        })
      ).json(),
    );
    expect(found.items).toMatchObject([
      { id: mira.id, objectType: "person", displayName: "Mira Chen" },
    ]);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/persons",
          headers: headers(stranger, owner.workspace.id),
        })
      ).statusCode,
    ).toBe(404);

    // Trash and recovery apply as to any canonical object; the contacts of
    // an earlier revision can be restored while the linked account stays.
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/objects/${sam.id}?expectedVersion=1`,
      headers: ownerHeaders,
    });
    expect(deleted.statusCode).toBe(200);
    const trash = trashListResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/api/trash?objectType=person",
          headers: ownerHeaders,
        })
      ).json(),
    );
    expect(trash.items.map(({ id }) => id)).toEqual([sam.id]);
    const recovered = await app.inject({
      method: "POST",
      url: `/api/objects/${sam.id}/recover`,
      headers: ownerHeaders,
      payload: { expectedVersion: 2 },
    });
    expect(recovered.statusCode).toBe(200);
    const restored = await app.inject({
      method: "POST",
      url: `/api/objects/${mira.id}/revisions/1/restore`,
      headers: ownerHeaders,
      payload: { expectedVersion: 2 },
    });
    expect(restored.statusCode).toBe(200);
    expect(personResponseSchema.parse(restored.json())).toMatchObject({
      displayName: "Mira",
      contacts: [],
      userId: owner.user.id,
      version: 3,
    });
  });

  it("keeps a nickname, a description, typed contacts, and labels on a person", async () => {
    const owner = await signIn("owner@example.com", "Zoe Owner");
    const ownerHeaders = headers(owner);
    const family = labelResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/labels",
          headers: ownerHeaders,
          payload: { name: "family" },
        })
      ).json(),
    );
    const created = await app.inject({
      method: "POST",
      url: "/api/persons",
      headers: ownerHeaders,
      payload: {
        displayName: "Mei Lin",
        nickname: " Mei ",
        description: "Sister.",
        contacts: [
          { kind: "phone", value: "+1 555 0100" },
          { kind: "email", value: " mei@example.test " },
        ],
        labelIds: [family.id],
      },
    });
    expect(created.statusCode).toBe(201);
    const mei = personResponseSchema.parse(created.json());
    expect(mei).toMatchObject({
      nickname: "Mei",
      description: "Sister.",
      contacts: [
        { kind: "phone", value: "+1 555 0100" },
        { kind: "email", value: "mei@example.test" },
      ],
      labelIds: [family.id],
    });

    // A new list replaces the contacts as a whole, in the order given; an
    // empty nickname reads as none.
    const reordered = await app.inject({
      method: "PATCH",
      url: `/api/persons/${mei.id}`,
      headers: ownerHeaders,
      payload: {
        expectedVersion: 1,
        contacts: [
          { kind: "email", value: "mei.lin@example.test" },
          { kind: "phone", value: "+1 555 0100" },
        ],
        nickname: "",
      },
    });
    expect(reordered.statusCode).toBe(200);
    expect(personResponseSchema.parse(reordered.json())).toMatchObject({
      nickname: null,
      contacts: [
        { kind: "email", value: "mei.lin@example.test" },
        { kind: "phone", value: "+1 555 0100" },
      ],
    });

    // An email contact that is not an address fails at the request boundary;
    // an unknown label fails in the service.
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/persons/${mei.id}`,
          headers: ownerHeaders,
          payload: {
            expectedVersion: 2,
            contacts: [{ kind: "email", value: "no-at-sign" }],
          },
        })
      ).statusCode,
    ).toBe(400);
    const unknownLabel = await app.inject({
      method: "PATCH",
      url: `/api/persons/${mei.id}`,
      headers: ownerHeaders,
      payload: { expectedVersion: 2, labelIds: [randomUUID()] },
    });
    expect(unknownLabel.statusCode).toBe(400);
    expect(unknownLabel.json()).toMatchObject({
      error: { message: "labelIds must name labels of this workspace." },
    });

    // A restore brings back the contacts, nickname, and description of the
    // earlier revision; the labels stay as they are.
    const emptied = await app.inject({
      method: "PATCH",
      url: `/api/persons/${mei.id}`,
      headers: ownerHeaders,
      payload: { expectedVersion: 2, contacts: [], labelIds: [] },
    });
    expect(emptied.statusCode).toBe(200);
    expect(personResponseSchema.parse(emptied.json())).toMatchObject({
      contacts: [],
      labelIds: [],
    });
    const restored = await app.inject({
      method: "POST",
      url: `/api/objects/${mei.id}/revisions/1/restore`,
      headers: ownerHeaders,
      payload: { expectedVersion: 3 },
    });
    expect(restored.statusCode).toBe(200);
    expect(personResponseSchema.parse(restored.json())).toMatchObject({
      nickname: "Mei",
      description: "Sister.",
      contacts: [
        { kind: "phone", value: "+1 555 0100" },
        { kind: "email", value: "mei@example.test" },
      ],
      labelIds: [],
      version: 4,
    });
  });
});
