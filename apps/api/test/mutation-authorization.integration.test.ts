import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { withStableAuthorization } from "@livtales/authorization";
import { createId, objects, resourceGrants } from "@livtales/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import {
  developmentSignInResponseSchema,
  documentAttachmentResponseSchema,
  documentUploadAuthorizationResponseSchema,
  documentDownloadAuthorizationResponseSchema,
  eventPlanningResourceResponseSchema,
} from "@livtales/schemas";
import { LocalFilesystemStorageProvider } from "@livtales/storage";
import { eq } from "drizzle-orm";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { createDevelopmentAppDependencies } from "../src/dependencies.js";

let database: TestDatabase;
let app: FastifyInstance;
let storage: LocalFilesystemStorageProvider;
let storageRoot: string;
let transferNow: Date | undefined;

beforeEach(async () => {
  transferNow = undefined;
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
  storageRoot = await mkdtemp(resolve(tmpdir(), "livtales-authorization-"));
  storage = new LocalFilesystemStorageProvider({ root: storageRoot });
  app = buildApp(
    createDevelopmentAppDependencies(database.connection, {
      storage,
      clock: () => transferNow ?? new Date(),
    }),
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
  await database?.close();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
});

async function signIn(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/development/sign-in",
    payload: { email, displayName: "Planner" },
  });
  expect(response.statusCode).toBe(200);
  return developmentSignInResponseSchema.parse(response.json());
}
type Session = Awaited<ReturnType<typeof signIn>>;
const headers = (session: Session, workspaceId = session.workspace.id) => ({
  authorization: `Bearer ${session.accessToken}`,
  "x-workspace-id": workspaceId,
});

async function create(
  session: Session,
  collection: string,
  fields: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/${collection}`,
    headers: headers(session),
    payload: { displayName: "Original", ...fields },
  });
  expect(response.statusCode).toBe(201);
  return eventPlanningResourceResponseSchema.parse(response.json());
}

async function sharedEvent() {
  const owner = await signIn("owner@example.com");
  const editor = await signIn("editor@example.com");
  const event = await create(owner, "events");
  const share = await app.inject({
    method: "POST",
    url: "/api/shares",
    headers: headers(owner),
    payload: {
      resourceId: event.id,
      principalEmail: "editor@example.com",
      role: "editor",
    },
  });
  expect(share.statusCode).toBe(201);
  return { owner, editor, event };
}

/** Hold a revocation ahead of a request and observe real PostgreSQL lock waits. */
async function duringRevocation(
  workspaceId: string,
  scopeId: string,
  objectId: string,
  request: InjectOptions,
) {
  let completed = false;
  let pending:
    Promise<Awaited<ReturnType<FastifyInstance["inject"]>>> | undefined;
  await withStableAuthorization(
    database.connection.db,
    workspaceId,
    async (transaction) => {
      await transaction
        .delete(resourceGrants)
        .where(eq(resourceGrants.resourceId, scopeId));
      // Keep the object writer waiting even when it has not acquired the workspace fence.
      await transaction
        .select({ id: objects.id })
        .from(objects)
        .where(eq(objects.id, objectId))
        .for("no key update");
      pending = app.inject(request);
      void pending.then(() => {
        completed = true;
      });
      await expect
        .poll(
          async () => {
            if (completed) return true;
            const [row] = await database.connection.sql<{ waiting: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND (query ILIKE '%workspaces%' OR query ILIKE '%objects%')
        ) AS waiting`;
            return row?.waiting;
          },
          { timeout: 3000 },
        )
        .toBe(true);
    },
  );
  if (pending === undefined) throw new Error("The request was not started.");
  return pending;
}

async function ledgerCounts() {
  const [counts] = await database.connection.sql`
    SELECT (SELECT count(*) FROM objects) AS objects,
      (SELECT count(*) FROM object_relations) AS relations,
      (SELECT count(*) FROM object_revisions) AS revisions,
      (SELECT count(*) FROM audit_events) AS audits,
      (SELECT count(*) FROM event_context_commands) AS commands`;
  return counts;
}

const resourceCases = [
  { collection: "events", fields: {} },
  { collection: "tasks", fields: {} },
  {
    collection: "expenses",
    fields: {
      amount: "10",
      currency: "USD",
      occurredAt: "2026-10-01T12:00:00Z",
    },
  },
  { collection: "reminders", fields: { remindAt: "2026-10-01T12:00:00Z" } },
];

describe.sequential("mutation authorization ordering", () => {
  it.each(resourceCases)(
    "rechecks $collection updates after revocation commits",
    async ({ collection, fields }) => {
      const { owner, editor, event } = await sharedEvent();
      const resource = await create(owner, collection, {
        ...fields,
        permissionScopeId: event.id,
      });
      const before = await ledgerCounts();
      const response = await duringRevocation(
        owner.workspace.id,
        event.id,
        resource.id,
        {
          method: "PATCH",
          url: `/api/${collection}/${resource.id}`,
          headers: headers(editor, owner.workspace.id),
          payload: { expectedVersion: 1, displayName: "Changed" },
        },
      );
      expect(response.statusCode).toBe(404);
      expect(await ledgerCounts()).toEqual(before);
      const [saved] = await database.connection.db
        .select()
        .from(objects)
        .where(eq(objects.id, resource.id));
      expect(saved).toMatchObject({ version: 1, displayName: "Original" });
    },
  );

  it.each(resourceCases)(
    "orders $collection creation after pending permission changes",
    async ({ collection, fields }) => {
      const { owner, editor, event } = await sharedEvent();
      const before = await ledgerCounts();
      const response = await duringRevocation(
        owner.workspace.id,
        event.id,
        event.id,
        {
          method: "POST",
          url: `/api/${collection}`,
          headers: headers(editor, owner.workspace.id),
          payload: {
            ...fields,
            displayName: "Child",
            permissionScopeId: event.id,
          },
        },
      );
      expect(response.statusCode).toBe(404);
      expect(await ledgerCounts()).toEqual(before);
    },
  );

  it.each(["relation", "context"])(
    "orders %s creation under the same authorization fence",
    async (operation) => {
      const { owner, editor, event } = await sharedEvent();
      const task = await create(owner, "tasks", {
        permissionScopeId: event.id,
      });
      const before = await ledgerCounts();
      const response = await duringRevocation(
        owner.workspace.id,
        event.id,
        event.id,
        {
          method: "POST",
          url:
            operation === "relation"
              ? `/api/objects/${event.id}/relations`
              : `/api/events/${event.id}/resources`,
          headers: headers(editor, owner.workspace.id),
          payload:
            operation === "relation"
              ? { targetObjectId: task.id, relationType: "includes" }
              : {
                  commandId: createId(),
                  resource: { objectType: "task", displayName: "New task" },
                },
        },
      );
      expect(response.statusCode).toBe(404);
      expect(await ledgerCounts()).toEqual(before);
    },
  );

  it("allows another workspace to write while a security mutation is pending", async () => {
    const owner = await signIn("owner@example.com");
    const other = await signIn("other@example.com");
    await withStableAuthorization(
      database.connection.db,
      owner.workspace.id,
      async () => {
        const resource = await create(other, "tasks");
        expect(resource.workspaceId).toBe(other.workspace.id);
      },
    );
  });

  async function uploadedFile(
    owner: Session,
    editor: Session,
    eventId: string,
  ) {
    const bytes = Buffer.from("Private attachment");
    const response = await app.inject({
      method: "POST",
      url: "/api/documents/upload-url",
      headers: headers(editor, owner.workspace.id),
      payload: {
        parentObjectId: eventId,
        originalFilename: "plan.txt",
        mimeType: "text/plain",
        sizeBytes: bytes.byteLength,
        checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      },
    });
    expect(response.statusCode).toBe(201);
    const authorization = documentUploadAuthorizationResponseSchema.parse(
      response.json(),
    );
    expect(
      (
        await app.inject({
          method: "PUT",
          url: authorization.upload.url,
          headers: authorization.upload.headers,
          payload: bytes,
        })
      ).statusCode,
    ).toBe(204);
    return authorization.id;
  }

  async function revoke(workspaceId: string, scopeId: string) {
    await withStableAuthorization(
      database.connection.db,
      workspaceId,
      async (transaction) => {
        await transaction
          .delete(resourceGrants)
          .where(eq(resourceGrants.resourceId, scopeId));
      },
    );
  }

  it("rechecks finalization after revocation during storage inspection", async () => {
    const { owner, editor, event } = await sharedEvent();
    const uploadAuthorizationId = await uploadedFile(owner, editor, event.id);
    const before = await ledgerCounts();
    const inspect = storage.inspectObject.bind(storage);
    vi.spyOn(storage, "inspectObject").mockImplementationOnce(async (key) => {
      const metadata = await inspect(key);
      await revoke(owner.workspace.id, event.id);
      return metadata;
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/documents",
      headers: headers(editor, owner.workspace.id),
      payload: { uploadAuthorizationId },
    });
    expect(response.statusCode).toBe(404);
    expect(await ledgerCounts()).toEqual(before);
    const [transfer] = await database.connection
      .sql`SELECT finalized_at FROM document_transfer_authorizations WHERE id = ${uploadAuthorizationId}`;
    expect(transfer?.finalized_at).toBeNull();
  });

  it("uses the current parent scope when it changes during file inspection", async () => {
    const { owner, event } = await sharedEvent();
    const task = await create(owner, "tasks", { permissionScopeId: event.id });
    const uploadAuthorizationId = await uploadedFile(owner, owner, task.id);
    const inspect = storage.inspectObject.bind(storage);
    vi.spyOn(storage, "inspectObject").mockImplementationOnce(async (key) => {
      const metadata = await inspect(key);
      const changed = await app.inject({
        method: "PATCH",
        url: `/api/objects/${task.id}/permission-scope`,
        headers: headers(owner),
        payload: { expectedVersion: 1, permissionScopeId: task.id },
      });
      expect(changed.statusCode).toBe(200);
      return metadata;
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/documents",
      headers: headers(owner),
      payload: { uploadAuthorizationId },
    });
    expect(response.statusCode).toBe(201);
    const { document } = documentAttachmentResponseSchema.parse(
      response.json(),
    );
    expect(document.permissionScopeId).toBe(task.id);
  });

  it.each(["upload", "download"])(
    "does not issue %s authorization after storage-provider work loses access",
    async (operation) => {
      const { owner, editor, event } = await sharedEvent();
      let request: InjectOptions;
      if (operation === "upload") {
        const authorize = storage.createUploadAuthorization.bind(storage);
        vi.spyOn(storage, "createUploadAuthorization").mockImplementationOnce(
          async (input) => {
            const transfer = await authorize(input);
            await revoke(owner.workspace.id, event.id);
            return transfer;
          },
        );
        request = {
          method: "POST",
          url: "/api/documents/upload-url",
          headers: headers(editor, owner.workspace.id),
          payload: {
            parentObjectId: event.id,
            originalFilename: "empty.txt",
            mimeType: "text/plain",
            sizeBytes: 0,
            checksumSha256: createHash("sha256").update("").digest("hex"),
          },
        };
      } else {
        const uploadAuthorizationId = await uploadedFile(
          owner,
          editor,
          event.id,
        );
        const response = await app.inject({
          method: "POST",
          url: "/api/documents",
          headers: headers(editor, owner.workspace.id),
          payload: { uploadAuthorizationId },
        });
        const { document } = documentAttachmentResponseSchema.parse(
          response.json(),
        );
        const authorize = storage.createDownloadAuthorization.bind(storage);
        vi.spyOn(storage, "createDownloadAuthorization").mockImplementationOnce(
          async (input) => {
            const transfer = await authorize(input);
            await revoke(owner.workspace.id, event.id);
            return transfer;
          },
        );
        request = {
          url: `/api/documents/${document.id}/download-url`,
          headers: headers(editor, owner.workspace.id),
        };
      }
      const before = await ledgerCounts();
      const response = await app.inject(request);
      expect(response.statusCode).toBe(404);
      expect(await ledgerCounts()).toEqual(before);
      const [transfers] = await database.connection
        .sql`SELECT count(*)::int AS count FROM document_transfer_authorizations WHERE operation = ${operation}`;
      expect(transfers?.count).toBe(0);
    },
  );

  it.each(["revocation", "expiry"])(
    "rejects download after %s during storage reads without consuming the token",
    async (change) => {
      const { owner, editor, event } = await sharedEvent();
      const uploadAuthorizationId = await uploadedFile(owner, editor, event.id);
      const finalized = await app.inject({
        method: "POST",
        url: "/api/documents",
        headers: headers(editor, owner.workspace.id),
        payload: { uploadAuthorizationId },
      });
      const { document } = documentAttachmentResponseSchema.parse(
        finalized.json(),
      );
      const authorized = await app.inject({
        url: `/api/documents/${document.id}/download-url`,
        headers: headers(editor, owner.workspace.id),
      });
      const { download } = documentDownloadAuthorizationResponseSchema.parse(
        authorized.json(),
      );
      const before = await ledgerCounts();
      const read = storage.readObject.bind(storage);
      vi.spyOn(storage, "readObject").mockImplementationOnce(async (key) => {
        const bytes = await read(key);
        if (change === "revocation") await revoke(owner.workspace.id, event.id);
        else transferNow = new Date(Date.now() + 10 * 60_000);
        return bytes;
      });
      const response = await app.inject({ url: download.url });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain("Private attachment");
      expect(await ledgerCounts()).toEqual(before);
      const [transfer] = await database.connection
        .sql`SELECT consumed_at FROM document_transfer_authorizations WHERE operation = 'download'`;
      expect(transfer?.consumed_at).toBeNull();
    },
  );
});
