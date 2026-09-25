import { resolve } from "node:path";

import { auditEvents, disconnectedDatabase } from "@livtales/db";
import {
  applyMigrations,
  createCloudBaseLiveReader,
  createCloudBaseRpcDouble,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import {
  commandStateResponseSchema,
  developmentSignInResponseSchema,
  eventContextCreateResponseSchema,
  eventListResponseSchema,
  eventResponseSchema,
  objectAccessResponseSchema,
  shareLeaveResponseSchema,
  taskResourceProjectionResponseSchema,
  taskResponseSchema,
} from "@livtales/schemas";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { createDevelopmentAppDependencies } from "../src/dependencies.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);

// Shared events go through the HTTP contract, so they are run on both
// backends: the PostgreSQL app, and the app composed for the gateway with
// the rpc functions called locally and no database connection.
const transportWrite = () =>
  Promise.reject(new Error("Shared events write through the rpc functions."));
const backends = {
  postgres: (database: TestDatabase) =>
    createDevelopmentAppDependencies(database.connection),
  cloudbase: (database: TestDatabase) =>
    createDevelopmentAppDependencies(
      disconnectedDatabase("the shared events test"),
      {
        cloudBaseRdb: {
          ...createCloudBaseLiveReader(database.connection.db),
          rpc: createCloudBaseRpcDouble(database.connection.sql),
          insert: transportWrite,
          update: transportWrite,
          delete: transportWrite,
        },
        cloudBaseWrites: true,
      },
    ),
};

let testDatabase: TestDatabase;
let app: FastifyInstance;
let ready = false;

beforeEach(async () => {
  ready = false;
  testDatabase = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: testDatabase.databaseUrl },
    migrationDirectory,
  );
});

afterEach(async () => {
  if (ready) {
    await app.close();
    await testDatabase.close();
  }
  ready = false;
});

type Session = ReturnType<typeof developmentSignInResponseSchema.parse>;

async function signIn(email: string, displayName: string): Promise<Session> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/development/sign-in",
    payload: { email, displayName },
  });
  expect(response.statusCode).toBe(200);
  return developmentSignInResponseSchema.parse(response.json());
}

function request(
  session: Session,
  options: Omit<InjectOptions, "headers">,
  workspaceId = session.workspace.id,
) {
  return app.inject({
    ...options,
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-workspace-id": workspaceId,
    },
  });
}

async function createEvent(session: Session, displayName: string) {
  const response = await request(session, {
    method: "POST",
    url: "/api/events",
    payload: { displayName, startsAt: "2030-10-15T16:00:00Z" },
  });
  expect(response.statusCode).toBe(201);
  return eventResponseSchema.parse(response.json());
}

async function share(
  session: Session,
  resourceId: string,
  principalEmail: string,
  role: "viewer" | "editor",
) {
  const response = await request(session, {
    method: "POST",
    url: "/api/shares",
    payload: { resourceId, principalEmail, role },
  });
  expect(response.statusCode).toBe(201);
}

async function listEvents(session: Session, query = "") {
  const response = await request(session, {
    method: "GET",
    url: `/api/events${query}`,
  });
  expect(response.statusCode).toBe(200);
  return eventListResponseSchema.parse(response.json());
}

describe.each(Object.entries(backends))(
  "Shared events in place (%s)",
  (_backend, compose) => {
    beforeEach(() => {
      app = buildApp(compose(testDatabase));
      ready = true;
    });

    it("lists the events shared with the account beside its own, with their access and counts", async () => {
      const mei = await signIn("mei@example.com", "Mei Lin");
      const kai = await signIn("kai@example.com", "Kai Tanaka");
      await signIn("ana@example.com", "Ana Souza");
      const kyoto = await createEvent(mei, "Kyoto in November");
      await createEvent(mei, "Mei alone");
      const wedding = await createEvent(kai, "Wedding countdown");
      await share(mei, kyoto.id, "kai@example.com", "viewer");
      await share(kai, wedding.id, "mei@example.com", "editor");
      await share(kai, wedding.id, "ana@example.com", "viewer");

      const all = await listEvents(kai);
      expect(
        all.items.map((item) => [
          item.displayName,
          item.workspaceId,
          item.access,
        ]),
      ).toEqual([
        [
          "Kyoto in November",
          mei.workspace.id,
          {
            sharedBy: { userId: mei.user.id, displayName: "Mei Lin" },
            role: "viewer",
            sharedWith: 0,
          },
        ],
        [
          "Wedding countdown",
          kai.workspace.id,
          { sharedBy: null, role: null, sharedWith: 2 },
        ],
      ]);
      expect(all.counts).toEqual({
        all: 2,
        mine: 1,
        shared: 1,
        upcoming: 2,
        past: 0,
      });

      const mine = await listEvents(kai, "?scope=mine");
      expect(mine.items.map((item) => item.displayName)).toEqual([
        "Wedding countdown",
      ]);
      const shared = await listEvents(kai, "?scope=shared");
      expect(shared.items.map((item) => item.displayName)).toEqual([
        "Kyoto in November",
      ]);
      // The typed query narrows the counts with the list.
      const found = await listEvents(kai, "?query=kyoto");
      expect(found.items.map((item) => item.displayName)).toEqual([
        "Kyoto in November",
      ]);
      expect(found.counts).toMatchObject({ all: 1, mine: 0, shared: 1 });
      // A second page carries no counts.
      const paged = await listEvents(kai, "?limit=1");
      expect(paged.nextCursor).not.toBeNull();
      const rest = await listEvents(kai, `?limit=1&cursor=${paged.nextCursor}`);
      expect(rest.counts).toBeNull();
      expect(rest.items.map((item) => item.displayName)).toEqual([
        "Wedding countdown",
      ]);
      // Mei's own list: two of hers, one shared by Kai at editor.
      const meis = await listEvents(mei);
      expect(
        meis.items.map((item) => [item.displayName, item.access.role]),
      ).toEqual([
        ["Kyoto in November", null],
        ["Mei alone", null],
        ["Wedding countdown", "editor"],
      ]);
      expect(meis.items[0]?.access.sharedWith).toBe(1);
    });

    it("opens a shared event in its own workspace from the account's session", async () => {
      const mei = await signIn("mei@example.com", "Mei Lin");
      const kai = await signIn("kai@example.com", "Kai Tanaka");
      const kyoto = await createEvent(mei, "Kyoto in November");
      const taskResponse = await request(mei, {
        method: "POST",
        url: `/api/events/${kyoto.id}/resources`,
        payload: {
          commandId: crypto.randomUUID(),
          resource: {
            objectType: "task",
            displayName: "Book the ryokan",
            dueAt: "2030-10-10T18:00:00Z",
          },
        },
      });
      expect(taskResponse.statusCode).toBe(201);
      await share(mei, kyoto.id, "kai@example.com", "viewer");

      // The session header names Kai's workspace; the event names Mei's.
      const opened = await request(kai, {
        method: "GET",
        url: `/api/events/${kyoto.id}`,
      });
      expect(opened.statusCode).toBe(200);
      expect(eventResponseSchema.parse(opened.json()).workspaceId).toBe(
        mei.workspace.id,
      );
      const access = await request(kai, {
        method: "GET",
        url: `/api/objects/${kyoto.id}/access`,
      });
      expect(objectAccessResponseSchema.parse(access.json())).toMatchObject({
        actions: ["view"],
        source: { kind: "direct" },
      });
      const todos = await request(kai, {
        method: "GET",
        url: `/api/events/${kyoto.id}/todos`,
      });
      expect(todos.statusCode).toBe(200);
      expect(
        taskResourceProjectionResponseSchema
          .parse(todos.json())
          .items.map((item) => item.displayName),
      ).toEqual(["Book the ryokan"]);
      // An object out of reach leaves the session where the header put it.
      const stranger = await signIn("ana@example.com", "Ana Souza");
      const denied = await request(stranger, {
        method: "GET",
        url: `/api/events/${kyoto.id}`,
      });
      expect(denied.statusCode).toBe(404);
    });

    it("saves, undoes, and redoes an edit to a shared task where it lives", async () => {
      const mei = await signIn("mei@example.com", "Mei Lin");
      const kai = await signIn("kai@example.com", "Kai Tanaka");
      const wedding = await createEvent(mei, "Wedding countdown");
      const created = await request(mei, {
        method: "POST",
        url: `/api/events/${wedding.id}/resources`,
        payload: {
          commandId: crypto.randomUUID(),
          resource: { objectType: "task", displayName: "Call the florist" },
        },
      });
      expect(created.statusCode).toBe(201);
      const task = eventContextCreateResponseSchema.parse(
        created.json(),
      ).resource;
      await share(mei, wedding.id, "kai@example.com", "editor");

      const commandState = async (objectId?: string) => {
        const response = await request(kai, {
          method: "GET",
          url:
            objectId === undefined
              ? "/api/commands"
              : `/api/commands?objectId=${objectId}`,
        });
        expect(response.statusCode).toBe(200);
        return commandStateResponseSchema.parse(response.json());
      };
      const readTask = async () => {
        const response = await request(kai, {
          method: "GET",
          url: `/api/tasks/${task.id}`,
        });
        expect(response.statusCode).toBe(200);
        return taskResponseSchema.parse(response.json());
      };

      // Kai's session header names his workspace; the task lives in Mei's.
      const commandId = crypto.randomUUID();
      const saved = await request(kai, {
        method: "POST",
        url: "/api/commands",
        payload: {
          operationId: commandId,
          expectedStackVersion: 0,
          edits: [
            {
              objectType: "task",
              objectId: task.id,
              patch: {
                expectedVersion: task.version,
                displayName: "Call the florist today",
                description: "Peonies, not roses",
              },
            },
          ],
        },
      });
      expect(saved.statusCode).toBe(200);
      expect(await readTask()).toMatchObject({
        displayName: "Call the florist today",
        description: "Peonies, not roses",
        version: 2,
      });
      // The command sits on Kai's stack in Mei's workspace, not in his own.
      expect(await commandState()).toMatchObject({ version: 0, undo: null });
      expect(await commandState(wedding.id)).toMatchObject({
        version: 1,
        undo: { commandId, available: true },
      });

      const undone = await request(kai, {
        method: "POST",
        url: `/api/commands/undo?objectId=${wedding.id}`,
        payload: {
          operationId: crypto.randomUUID(),
          commandId,
          expectedStackVersion: 1,
        },
      });
      expect(undone.statusCode).toBe(200);
      expect(await readTask()).toMatchObject({
        displayName: "Call the florist",
        description: null,
      });
      const redone = await request(kai, {
        method: "POST",
        url: `/api/commands/redo?objectId=${task.id}`,
        payload: {
          operationId: crypto.randomUUID(),
          commandId,
          expectedStackVersion: 2,
        },
      });
      expect(redone.statusCode).toBe(200);
      expect(await readTask()).toMatchObject({
        displayName: "Call the florist today",
        description: "Peonies, not roses",
      });

      // An account without edit access still cannot save there.
      const stranger = await signIn("ana@example.com", "Ana Souza");
      const refused = await request(stranger, {
        method: "POST",
        url: "/api/commands",
        payload: {
          operationId: crypto.randomUUID(),
          expectedStackVersion: 0,
          edits: [
            {
              objectType: "task",
              objectId: task.id,
              patch: { expectedVersion: 4, displayName: "Taken over" },
            },
          ],
        },
      });
      expect(refused.statusCode).toBe(404);
    });

    it("lets a grantee leave an event, and no one else", async () => {
      const mei = await signIn("mei@example.com", "Mei Lin");
      const kai = await signIn("kai@example.com", "Kai Tanaka");
      const kyoto = await createEvent(mei, "Kyoto in November");
      await share(mei, kyoto.id, "kai@example.com", "viewer");
      const shareTodos = await request(mei, {
        method: "POST",
        url: "/api/shares",
        payload: {
          resourceId: kyoto.id,
          principalEmail: "kai@example.com",
          role: "editor",
          scope: { view: "todos", sectionId: null },
        },
      });
      expect(shareTodos.statusCode).toBe(201);
      expect((await listEvents(kai)).items).toHaveLength(1);

      // The owner has no grant to give up.
      const ownerLeave = await request(mei, {
        method: "POST",
        url: `/api/objects/${kyoto.id}/leave`,
      });
      expect(ownerLeave.statusCode).toBe(404);

      const left = await request(kai, {
        method: "POST",
        url: `/api/objects/${kyoto.id}/leave`,
      });
      expect(left.statusCode).toBe(200);
      const leave = shareLeaveResponseSchema.parse(left.json());
      expect(leave.resourceId).toBe(kyoto.id);
      expect(leave.grantIds).toHaveLength(2);
      expect((await listEvents(kai)).items).toHaveLength(0);
      const gone = await request(kai, {
        method: "GET",
        url: `/api/events/${kyoto.id}`,
      });
      expect(gone.statusCode).toBe(404);
      const audit = await testDatabase.connection.db
        .select({ metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.action, "resource.share_left"),
            eq(auditEvents.resourceId, kyoto.id),
          ),
        );
      expect(audit).toHaveLength(1);
      expect(audit[0]?.metadata).toEqual({ grantIds: leave.grantIds });
      // Leaving twice finds nothing to leave.
      const again = await request(kai, {
        method: "POST",
        url: `/api/objects/${kyoto.id}/leave`,
      });
      expect(again.statusCode).toBe(404);
    });
  },
);
