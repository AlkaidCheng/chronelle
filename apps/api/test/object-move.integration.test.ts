import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { disconnectedDatabase } from "@livtales/db";
import {
  applyMigrations,
  createCloudBaseLiveReader,
  createCloudBaseRpcDouble,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import {
  accessibleWorkspaceSchema,
  apiErrorResponseSchema,
  commandReceiptSchema,
  commandStateResponseSchema,
  developmentSignInResponseSchema,
  documentAttachmentResponseSchema,
  documentDownloadAuthorizationResponseSchema,
  documentUploadAuthorizationResponseSchema,
  eventResponseSchema,
  labelListResponseSchema,
  labelResponseSchema,
  objectMovePreviewSchema,
  objectMoveResponseSchema,
  objectMoveTargetsResponseSchema,
  personResponseSchema,
  revisionListResponseSchema,
  sentInvitationSchema,
  taskResponseSchema,
} from "@livtales/schemas";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import {
  type AppDependencyOptions,
  createDevelopmentAppDependencies,
} from "../src/dependencies.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);

// Moving an Event to another space goes through the HTTP contract, so it
// is run on both backends: the PostgreSQL app, and the app composed for the
// gateway with the rpc functions called locally and no database connection.
const transportWrite = () =>
  Promise.reject(new Error("A move writes through the rpc functions."));
const backends = {
  postgres: (database: TestDatabase, options: AppDependencyOptions) =>
    createDevelopmentAppDependencies(database.connection, options),
  cloudbase: (database: TestDatabase, options: AppDependencyOptions) =>
    createDevelopmentAppDependencies(disconnectedDatabase("the move test"), {
      ...options,
      cloudBaseRdb: {
        ...createCloudBaseLiveReader(database.connection.db),
        rpc: createCloudBaseRpcDouble(database.connection.sql),
        insert: transportWrite,
        update: transportWrite,
        delete: transportWrite,
      },
      cloudBaseWrites: true,
    }),
};

let testDatabase: TestDatabase;
let storageRoot: string;
let app: FastifyInstance;

beforeEach(async () => {
  testDatabase = await createTestDatabase();
  storageRoot = await mkdtemp(join(tmpdir(), "livtales-move-"));
  await applyMigrations(
    { DATABASE_URL: testDatabase.databaseUrl },
    migrationDirectory,
  );
});

afterEach(async () => {
  await app?.close();
  await testDatabase.close();
  await rm(storageRoot, { recursive: true, force: true });
});

type Session = ReturnType<typeof developmentSignInResponseSchema.parse>;

async function signIn(name: string): Promise<Session> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/development/sign-in",
    payload: { email: `${name.toLowerCase()}@example.test`, displayName: name },
  });
  expect(response.statusCode).toBe(200);
  return developmentSignInResponseSchema.parse(response.json());
}

function request(
  session: Session,
  workspaceId: string,
  options: Omit<InjectOptions, "headers">,
) {
  return app.inject({
    ...options,
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-workspace-id": workspaceId,
    },
  });
}

/** A request that must succeed, with its JSON body. */
async function ok(
  session: Session,
  workspaceId: string,
  options: Omit<InjectOptions, "headers">,
  status = 200,
): Promise<unknown> {
  const response = await request(session, workspaceId, options);
  expect(response.statusCode, response.body).toBe(status);
  return response.json();
}

/** A refused request's status and error code. */
async function refusal(
  session: Session,
  workspaceId: string,
  options: Omit<InjectOptions, "headers">,
) {
  const response = await request(session, workspaceId, options);
  return {
    status: response.statusCode,
    code: apiErrorResponseSchema.parse(response.json()).error.code,
  };
}

/** Two accounts become friends; returns the requester's friend id for the other. */
async function befriend(requester: Session, addressee: Session) {
  const sent = sentInvitationSchema.parse(
    await ok(
      requester,
      requester.workspace.id,
      {
        method: "POST",
        url: "/api/friends/invitations",
        payload: { email: addressee.user.email },
      },
      201,
    ),
  );
  await ok(addressee, addressee.workspace.id, {
    method: "POST",
    url: `/api/friends/requests/${sent.id}/accept`,
  });
  return sent.id;
}

async function createSpace(session: Session, displayName: string) {
  return accessibleWorkspaceSchema.parse(
    await ok(
      session,
      session.workspace.id,
      { method: "POST", url: "/api/workspaces", payload: { displayName } },
      201,
    ),
  );
}

async function addMember(
  owner: Session,
  workspaceId: string,
  friendId: string,
  role: "owner" | "editor" | "viewer",
) {
  await ok(
    owner,
    workspaceId,
    {
      method: "POST",
      url: "/api/workspaces/current/members",
      payload: { friendId, role },
    },
    201,
  );
}

async function createEvent(
  session: Session,
  workspaceId: string,
  displayName: string,
) {
  return eventResponseSchema.parse(
    await ok(
      session,
      workspaceId,
      { method: "POST", url: "/api/events", payload: { displayName } },
      201,
    ),
  );
}

async function createPerson(
  session: Session,
  workspaceId: string,
  displayName: string,
) {
  return personResponseSchema.parse(
    await ok(
      session,
      workspaceId,
      { method: "POST", url: "/api/persons", payload: { displayName } },
      201,
    ),
  );
}

async function include(session: Session, eventId: string, targetId: string) {
  await ok(
    session,
    session.workspace.id,
    {
      method: "POST",
      url: `/api/objects/${eventId}/relations`,
      payload: { relationType: "includes", targetObjectId: targetId },
    },
    201,
  );
}

/** Uploads a file and attaches it to the Event; returns the document and its bytes. */
async function attachFile(
  session: Session,
  workspaceId: string,
  eventId: string,
) {
  const bytes = Buffer.from("private:floor-plan");
  const authorization = documentUploadAuthorizationResponseSchema.parse(
    await ok(
      session,
      workspaceId,
      {
        method: "POST",
        url: "/api/documents/upload-url",
        payload: {
          parentObjectId: eventId,
          checksumSha256: createHash("sha256").update(bytes).digest("hex"),
          mimeType: "application/pdf",
          originalFilename: "floor-plan.pdf",
          sizeBytes: bytes.byteLength,
        },
      },
      201,
    ),
  );
  const upload = await app.inject({
    method: "PUT",
    url: authorization.upload.url,
    headers: authorization.upload.headers,
    payload: bytes,
  });
  expect(upload.statusCode).toBe(204);
  const attachment = documentAttachmentResponseSchema.parse(
    await ok(
      session,
      workspaceId,
      {
        method: "POST",
        url: "/api/documents",
        payload: { uploadAuthorizationId: authorization.id },
      },
      201,
    ),
  );
  return { document: attachment.document, bytes };
}

async function commandState(session: Session, workspaceId: string) {
  return commandStateResponseSchema.parse(
    await ok(session, workspaceId, { method: "GET", url: "/api/commands" }),
  );
}

async function preview(session: Session, eventId: string, to: string) {
  return objectMovePreviewSchema.parse(
    await ok(session, session.workspace.id, {
      method: "GET",
      url: `/api/objects/${eventId}/move?to=${to}`,
    }),
  );
}

function move(
  session: Session,
  eventId: string,
  payload: Record<string, unknown>,
) {
  return request(session, session.workspace.id, {
    method: "POST",
    url: `/api/objects/${eventId}/move`,
    payload,
  });
}

describe.each(Object.entries(backends))(
  "Moving an Event to another space (%s)",
  (_backend, compose) => {
    beforeEach(() => {
      app = buildApp(compose(testDatabase, { localStorageRoot: storageRoot }));
    });

    it("moves an Event with its file, history, and guest, and drops the links it named", async () => {
      const olivia = await signIn("Olivia");
      const dan = await signIn("Dan");
      const eve = await signIn("Eve");
      const gus = await signIn("Gus");
      const home = await createSpace(olivia, "Home");
      const wedding = await createSpace(olivia, "Our wedding");
      await addMember(olivia, home.id, await befriend(olivia, dan), "editor");
      await addMember(
        olivia,
        wedding.id,
        await befriend(olivia, eve),
        "viewer",
      );

      // An Event planned in Home: a to-do assigned to a People card of
      // Home with a label, a link to that card, a file, a guest's share,
      // and an undo entry.
      const label = labelResponseSchema.parse(
        await ok(
          olivia,
          home.id,
          { method: "POST", url: "/api/labels", payload: { name: "Venue" } },
          201,
        ),
      );
      const ana = await createPerson(olivia, home.id, "Ana");
      const gala = await createEvent(olivia, home.id, "Gala");
      const task = taskResponseSchema.parse(
        await ok(
          olivia,
          home.id,
          {
            method: "POST",
            url: "/api/tasks",
            payload: {
              displayName: "Book the hall",
              permissionScopeId: gala.id,
              assigneeId: ana.id,
              labelIds: [label.id],
            },
          },
          201,
        ),
      );
      await include(olivia, gala.id, ana.id);
      const file = await attachFile(olivia, home.id, gala.id);
      await ok(
        olivia,
        home.id,
        {
          method: "POST",
          url: "/api/shares",
          payload: {
            resourceId: gala.id,
            principalEmail: gus.user.email,
            role: "viewer",
          },
        },
        201,
      );
      const stack = await commandState(olivia, home.id);
      const edit = commandReceiptSchema.parse(
        await ok(olivia, home.id, {
          method: "POST",
          url: "/api/commands",
          payload: {
            operationId: randomUUID(),
            expectedStackVersion: stack.version,
            edits: [
              {
                objectType: "event",
                objectId: gala.id,
                patch: { expectedVersion: 1, displayName: "Gala night" },
              },
            ],
          },
        }),
      );
      expect((await commandState(olivia, home.id)).undo).toEqual({
        commandId: edit.commandId,
        available: true,
      });

      // The session follows the Event to Home whatever the header names.
      const targets = objectMoveTargetsResponseSchema.parse(
        await ok(olivia, olivia.workspace.id, {
          method: "GET",
          url: `/api/objects/${gala.id}/move/targets`,
        }),
      );
      expect(
        targets.items.map(({ workspace, memberCount, current, allowed }) => [
          workspace.personal ? "Personal" : workspace.displayName,
          workspace.role,
          memberCount,
          current,
          allowed,
        ]),
      ).toEqual([
        ["Personal", "owner", 1, false, true],
        ["Home", "owner", 2, true, false],
        ["Our wedding", "owner", 2, false, true],
      ]);

      const reviewed = await preview(olivia, gala.id, wedding.id);
      expect(reviewed).toMatchObject({
        eventId: gala.id,
        from: { id: home.id, displayName: "Home", role: "owner" },
        to: { id: wedding.id, displayName: "Our wedding", role: "owner" },
        moves: { todos: 1, files: 1, shares: 1 },
        droppedLinks: {
          items: [
            {
              relationType: "includes",
              scoped: { id: gala.id, displayName: "Gala night" },
              other: { id: ana.id, objectType: "person", displayName: "Ana" },
            },
          ],
          total: 1,
        },
        unassignedTasks: {
          items: [
            {
              taskId: task.id,
              displayName: "Book the hall",
              person: { id: ana.id, displayName: "Ana" },
            },
          ],
          total: 1,
        },
        labels: { items: [{ name: "Venue", existing: false }], total: 1 },
        access: {
          targetMembers: { owner: 1, editor: 0, viewer: 1 },
          keepingShares: {
            items: [{ userId: gus.user.id, role: "viewer" }],
            total: 1,
          },
          losingAccess: {
            items: [{ userId: dan.user.id, displayName: "Dan" }],
            total: 1,
          },
        },
        expectedDroppedLinks: 2,
      });

      // A link added after the preview is never dropped unseen.
      const cleo = await createPerson(olivia, home.id, "Cleo");
      await include(olivia, gala.id, cleo.id);
      expect(
        await refusal(olivia, home.id, {
          method: "POST",
          url: `/api/objects/${gala.id}/move`,
          payload: {
            workspaceId: wedding.id,
            expectedDroppedLinks: reviewed.expectedDroppedLinks,
          },
        }),
      ).toEqual({ status: 409, code: "move_changed" });
      const again = await preview(olivia, gala.id, wedding.id);
      expect(again.expectedDroppedLinks).toBe(3);

      const commandId = randomUUID();
      const payload = {
        workspaceId: wedding.id,
        expectedDroppedLinks: again.expectedDroppedLinks,
        commandId,
      };
      const response = await move(olivia, gala.id, payload);
      expect(response.statusCode, response.body).toBe(200);
      const moved = objectMoveResponseSchema.parse(response.json());
      expect(moved.event).toMatchObject({
        id: gala.id,
        workspaceId: wedding.id,
        displayName: "Gala night",
        version: 2,
      });
      expect(moved.move).toMatchObject({
        commandId,
        from: { id: home.id, displayName: "Home" },
        to: { id: wedding.id, displayName: "Our wedding" },
        droppedLinks: 2,
        unassignedTasks: 1,
        labelsJoined: 0,
        labelsCreated: 1,
        grantsDropped: 0,
      });

      // A retry returns the recorded result; the same command id for
      // another space is a conflict.
      const replay = await move(olivia, gala.id, payload);
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual(response.json());
      expect(
        await refusal(olivia, olivia.workspace.id, {
          method: "POST",
          url: `/api/objects/${gala.id}/move`,
          payload: { ...payload, workspaceId: olivia.workspace.id },
        }),
      ).toEqual({ status: 409, code: "command_conflict" });

      // The new space's members read it, the guest keeps it, and a member
      // of the old space alone no longer sees it.
      for (const reader of [eve, gus])
        expect(
          eventResponseSchema.parse(
            await ok(reader, reader.workspace.id, {
              method: "GET",
              url: `/api/events/${gala.id}`,
            }),
          ).workspaceId,
        ).toBe(wedding.id);
      expect(
        await refusal(dan, home.id, {
          method: "GET",
          url: `/api/events/${gala.id}`,
        }),
      ).toEqual({ status: 404, code: "resource_unavailable" });

      // Its history is listed where it now is, the to-do's rewrite on top.
      for (const [objectId, versions] of [
        [gala.id, [2, 1]],
        [task.id, [2, 1]],
      ] as const)
        expect(
          revisionListResponseSchema
            .parse(
              await ok(olivia, wedding.id, {
                method: "GET",
                url: `/api/objects/${objectId}/revisions`,
              }),
            )
            .items.map((item) => item.objectVersion),
        ).toEqual(versions);
      expect(
        taskResponseSchema.parse(
          await ok(olivia, wedding.id, {
            method: "GET",
            url: `/api/tasks/${task.id}`,
          }),
        ),
      ).toMatchObject({ workspaceId: wedding.id, assigneeId: null });
      const labels = labelListResponseSchema.parse(
        await ok(olivia, wedding.id, { method: "GET", url: "/api/labels" }),
      );
      expect(labels.items.map((item) => item.name)).toEqual(["Venue"]);

      // The file downloads from where it was stored.
      const download = documentDownloadAuthorizationResponseSchema.parse(
        await ok(olivia, wedding.id, {
          method: "GET",
          url: `/api/documents/${file.document.id}/download-url`,
        }),
      );
      expect(
        (await app.inject({ url: download.download.url })).rawPayload,
      ).toEqual(file.bytes);

      // The old space's stack no longer offers to undo the Event's edit;
      // the People cards stay in Home.
      expect(await commandState(olivia, home.id)).toEqual({
        version: stack.version + 2,
        undo: null,
        redo: null,
      });
      for (const card of [ana, cleo])
        expect(
          personResponseSchema.parse(
            await ok(olivia, home.id, {
              method: "GET",
              url: `/api/persons/${card.id}`,
            }),
          ).workspaceId,
        ).toBe(home.id);
    });

    it("refuses a move with the code of each reason", async () => {
      const olivia = await signIn("Olivia");
      const dan = await signIn("Dan");
      const sam = await signIn("Sam");
      const home = await createSpace(olivia, "Home");
      await addMember(olivia, home.id, await befriend(olivia, dan), "editor");
      const club = await createSpace(sam, "Book club");
      await addMember(sam, club.id, await befriend(sam, olivia), "viewer");
      const gala = await createEvent(olivia, home.id, "Gala");
      const task = taskResponseSchema.parse(
        await ok(
          olivia,
          home.id,
          {
            method: "POST",
            url: "/api/tasks",
            payload: { displayName: "Invite", permissionScopeId: gala.id },
          },
          201,
        ),
      );
      const trashed = await createEvent(olivia, home.id, "Picnic");
      await ok(olivia, home.id, {
        method: "DELETE",
        url: `/api/objects/${trashed.id}?expectedVersion=1`,
      });
      const personal = olivia.workspace.id;
      const post = (objectId: string, body: Record<string, unknown>) => ({
        method: "POST" as const,
        url: `/api/objects/${objectId}/move`,
        payload: body,
      });
      const to = (workspaceId: string, expectedDroppedLinks = 0) => ({
        workspaceId,
        expectedDroppedLinks,
      });
      const cases: [string, Session, Omit<InjectOptions, "headers">][] = [
        ["unseen", sam, post(gala.id, to(club.id))],
        [
          "unseen targets",
          sam,
          { method: "GET", url: `/api/objects/${gala.id}/move/targets` },
        ],
        [
          "unseen preview",
          sam,
          { method: "GET", url: `/api/objects/${gala.id}/move?to=${club.id}` },
        ],
        ["not an Owner", dan, post(gala.id, to(dan.workspace.id))],
        [
          "preview by a non-Owner",
          dan,
          {
            method: "GET",
            url: `/api/objects/${gala.id}/move?to=${dan.workspace.id}`,
          },
        ],
        ["a Viewer there", olivia, post(gala.id, to(club.id))],
        ["a to-do", olivia, post(task.id, to(personal))],
        ["in Trash", olivia, post(trashed.id, to(personal))],
        ["its own space", olivia, post(gala.id, to(home.id))],
        ["not a member", olivia, post(gala.id, to(sam.workspace.id))],
        ["no such space", olivia, post(gala.id, to(randomUUID()))],
        ["changed", olivia, post(gala.id, to(personal, 1))],
        ["no count", olivia, post(gala.id, { workspaceId: personal })],
        [
          "no target",
          olivia,
          { method: "GET", url: `/api/objects/${gala.id}/move` },
        ],
      ];
      const outcomes: Record<string, unknown> = {};
      for (const [label, session, options] of cases)
        outcomes[label] = await refusal(session, session.workspace.id, options);
      expect(outcomes).toEqual({
        unseen: { status: 404, code: "resource_unavailable" },
        "unseen targets": { status: 404, code: "resource_unavailable" },
        "unseen preview": { status: 404, code: "resource_unavailable" },
        "not an Owner": { status: 403, code: "move_forbidden" },
        "preview by a non-Owner": { status: 403, code: "move_forbidden" },
        "a Viewer there": { status: 403, code: "move_forbidden" },
        "a to-do": { status: 400, code: "move_not_movable" },
        "in Trash": { status: 400, code: "move_not_movable" },
        "its own space": { status: 400, code: "move_same_space" },
        "not a member": { status: 404, code: "workspace_unavailable" },
        "no such space": { status: 404, code: "workspace_unavailable" },
        changed: { status: 409, code: "move_changed" },
        "no count": { status: 400, code: "invalid_request" },
        "no target": { status: 400, code: "invalid_request" },
      });
      expect(
        eventResponseSchema.parse(
          await ok(olivia, home.id, {
            method: "GET",
            url: `/api/events/${gala.id}`,
          }),
        ),
      ).toMatchObject({ workspaceId: home.id, version: 1 });
    });
  },
);
