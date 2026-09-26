import { createHash } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { AuthorizationService } from "@livtales/authorization";
import {
  auditEvents,
  createId,
  documents,
  documentTransferAuthorizations,
  objectRevisions,
  objects,
  workspaceMembers,
} from "@livtales/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import { StorageInventoryService } from "@livtales/object-model";
import {
  developmentSignInResponseSchema,
  documentAttachmentResponseSchema,
  documentUploadAuthorizationResponseSchema,
  eventResponseSchema,
  storageInventoryResponseSchema,
} from "@livtales/schemas";
import {
  LocalFilesystemStorageProvider,
  type StorageProvider,
} from "@livtales/storage";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { createDevelopmentAppDependencies } from "../src/dependencies.js";
import { seedOwnerGrant } from "./owner-grant.js";

let database: TestDatabase;
let app: FastifyInstance;
let root: string;
let provider: LocalFilesystemStorageProvider;
let currentTime: Date;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "livtales-inventory-api-"));
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
  provider = new LocalFilesystemStorageProvider({ root });
  currentTime = new Date("2026-10-01T12:00:00Z");
  app = buildApp(
    createDevelopmentAppDependencies(database.connection, {
      storage: provider,
      clock: () => currentTime,
      documentTransferTtlMs: 60_000,
    }),
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await app?.close();
    await database?.close();
  } finally {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
});

async function signIn(email = "owner@example.com") {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/development/sign-in",
    payload: { email, displayName: "Planner" },
  });
  expect(response.statusCode).toBe(200);
  return developmentSignInResponseSchema.parse(response.json());
}
type Session = Awaited<ReturnType<typeof signIn>>;

function request(
  session: Session,
  options: Omit<InjectOptions, "headers"> = {
    method: "GET",
    url: "/api/workspace/storage-inventory",
  },
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

async function createEvent(session: Session) {
  const response = await request(session, {
    method: "POST",
    url: "/api/events",
    payload: { displayName: "Private event" },
  });
  expect(response.statusCode).toBe(201);
  return eventResponseSchema.parse(response.json());
}

async function authorizeUpload(session: Session, parentObjectId: string) {
  const bytes = Buffer.from("private document bytes");
  const response = await request(session, {
    method: "POST",
    url: "/api/documents/upload-url",
    payload: {
      parentObjectId,
      originalFilename: "private.txt",
      mimeType: "text/plain",
      sizeBytes: bytes.length,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    },
  });
  expect(response.statusCode).toBe(201);
  return {
    ...documentUploadAuthorizationResponseSchema.parse(response.json()),
    bytes,
  };
}

async function uploadBytes(
  upload: Awaited<ReturnType<typeof authorizeUpload>>,
) {
  const response = await app.inject({
    method: "PUT",
    url: upload.upload.url,
    headers: upload.upload.headers,
    payload: upload.bytes,
  });
  expect(response.statusCode).toBe(204);
}

async function finalize(session: Session, uploadAuthorizationId: string) {
  const response = await request(session, {
    method: "POST",
    url: "/api/documents",
    payload: { uploadAuthorizationId },
  });
  expect(response.statusCode).toBe(201);
  return documentAttachmentResponseSchema.parse(response.json());
}

async function attach(session: Session, parentObjectId: string) {
  const upload = await authorizeUpload(session, parentObjectId);
  await uploadBytes(upload);
  return finalize(session, upload.id);
}

function storageKey(session: Session) {
  return `workspaces/${session.workspace.id}/documents/${createId()}`;
}

async function appendRevision(
  objectId: string,
  snapshotPatch: Record<string, unknown>,
  snapshotSchemaVersion = 1,
) {
  await database.connection.db.transaction(async (transaction) => {
    const [previous] = await transaction
      .select()
      .from(objectRevisions)
      .where(eq(objectRevisions.objectId, objectId))
      .orderBy(desc(objectRevisions.objectVersion))
      .limit(1);
    if (previous === undefined) throw new Error("Missing document fixture");
    const version = previous.objectVersion + 1;
    const requestId = createId();
    const auditEventId = createId();
    await transaction
      .update(objects)
      .set({ version })
      .where(eq(objects.id, objectId));
    await transaction.insert(auditEvents).values({
      id: auditEventId,
      workspaceId: previous.workspaceId,
      resourceId: objectId,
      actorType: previous.actorType,
      actorId: previous.actorId,
      requestId,
      action: "document.updated",
      metadata: {},
    });
    await transaction.insert(objectRevisions).values({
      ...previous,
      id: createId(),
      objectVersion: version,
      mutationKind: "updated",
      auditEventId,
      requestId,
      snapshotSchemaVersion,
      snapshot: { ...previous.snapshot, version, ...snapshotPatch },
    });
  });
}

/**
 * An Event of the origin holding a Document and a consumed upload under keys
 * the origin minted, as raw rows without history, moved to the destination
 * by the one UPDATE of objects.workspace_id a move is made of. The
 * destination then records the Document's revision, which names the key.
 */
async function moveRecordsWithFiles(origin: Session, destination: Session) {
  const db = database.connection.db;
  const eventId = createId();
  const documentId = createId();
  const keys = { document: storageKey(origin), upload: storageKey(origin) };
  await db.insert(objects).values(
    [
      { id: eventId, objectType: "event" as const, displayName: "Moved" },
      { id: documentId, objectType: "document" as const, displayName: "In" },
    ].map((object) => ({
      ...object,
      workspaceId: origin.workspace.id,
      createdBy: origin.user.id,
      permissionScopeId: eventId,
    })),
  );
  await db.insert(documents).values({
    objectId: documentId,
    workspaceId: origin.workspace.id,
    storageProvider: provider.providerId,
    storageKey: keys.document,
    originalFilename: "In.txt",
    mimeType: "text/plain",
    sizeBytes: 12n,
    checksumSha256: "a".repeat(64),
  });
  await db.insert(documentTransferAuthorizations).values({
    id: createId(),
    workspaceId: origin.workspace.id,
    operation: "upload",
    tokenHash: createHash("sha256").update(keys.upload).digest("hex"),
    resourceId: eventId,
    storageProvider: provider.providerId,
    storageKey: keys.upload,
    originalFilename: "upload.txt",
    mimeType: "text/plain",
    sizeBytes: 12n,
    checksumSha256: "b".repeat(64),
    authorizedBy: origin.user.id,
    createdAt: currentTime,
    expiresAt: new Date(currentTime.getTime() + 60_000),
    consumedAt: currentTime,
  });
  await db
    .update(objects)
    .set({ workspaceId: destination.workspace.id })
    .where(inArray(objects.id, [eventId, documentId]));

  const auditEventId = createId();
  const requestId = createId();
  const actor = { actorType: "user" as const, actorId: destination.user.id };
  await db.insert(auditEvents).values({
    id: auditEventId,
    workspaceId: destination.workspace.id,
    resourceId: documentId,
    ...actor,
    requestId,
    action: "document.created",
    metadata: {},
  });
  await db.insert(objectRevisions).values({
    id: createId(),
    workspaceId: destination.workspace.id,
    objectId: documentId,
    objectVersion: 1,
    mutationKind: "created",
    ...actor,
    requestId,
    auditEventId,
    snapshotSchemaVersion: 1,
    snapshot: {
      id: documentId,
      workspaceId: destination.workspace.id,
      objectType: "document",
      version: 1,
      displayName: "In",
      storageProvider: provider.providerId,
      storageKey: keys.document,
    },
  });
  return keys;
}

function principal(session: Session) {
  return {
    type: "user" as const,
    userId: session.user.id,
    workspaceId: session.workspace.id,
  };
}

describe.sequential("workspace storage inventory", () => {
  it("retains canonical files with abandoned publication links without leaking their keys", async () => {
    const session = await signIn();
    const attachment = await attach(session, (await createEvent(session)).id);
    const db = database.connection.db;
    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.objectId, attachment.document.id));
    if (!document) throw new Error("Missing document fixture");
    const path = join(root, document.storageKey);
    const abandonedDirectory = join(dirname(path), ".upload-abandoned");
    const abandonedPath = join(abandonedDirectory, "content");
    await mkdir(abandonedDirectory, { mode: 0o700 });
    await link(path, abandonedPath);
    const audits = await db.select().from(auditEvents).orderBy(auditEvents.id);

    const response = await request(session);

    expect(response.statusCode).toBe(200);
    expect(storageInventoryResponseSchema.parse(response.json())).toMatchObject(
      {
        consistency: "observational",
        retentionPolicy: "retain-all",
        references: { canonical: 1, missingCanonical: 1 },
        entries: { canonical: 0, unsupported: 2, unreferenced: 0 },
      },
    );
    expect(await readFile(path)).toEqual(await readFile(abandonedPath));
    expect(await db.select().from(auditEvents).orderBy(auditEvents.id)).toEqual(
      audits,
    );
    for (const secret of [document.storageKey, document.objectId, ".upload-"])
      expect(response.body).not.toContain(secret);
  });

  it.each(["duplicate", "wrong-prefix"])(
    "rejects invalid provider enumeration: %s",
    async (kind) => {
      const session = await signIn();
      const key = storageKey(session);
      vi.spyOn(provider, "listObjects").mockImplementation(async function* () {
        yield { storageKey: key, kind: "file" };
        yield {
          storageKey: kind === "duplicate" ? key : `other/${createId()}`,
          kind: "file",
        };
      });
      const response = await request(session);
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain("entries");
      expect(response.body).not.toContain(key);
    },
  );
  it("retains canonical documents through archive, trash, and unlinking without changing files or ledgers", async () => {
    const session = await signIn();
    const event = await createEvent(session);
    const live = await attach(session, event.id);
    const archived = await attach(session, event.id);
    const trashed = await attach(session, event.id);
    const unlinked = await attach(session, event.id);
    const db = database.connection.db;
    await db
      .update(objects)
      .set({ archivedAt: currentTime })
      .where(eq(objects.id, archived.document.id));
    expect(
      (
        await request(session, {
          method: "DELETE",
          url: `/api/objects/${trashed.document.id}?expectedVersion=1`,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request(session, {
          method: "DELETE",
          url: `/api/relations/${unlinked.relationId}?expectedVersion=1`,
        })
      ).statusCode,
    ).toBe(200);
    const historicalKey = storageKey(session);
    await appendRevision(live.document.id, { storageKey: historicalKey });
    await writeFile(join(root, historicalKey), "historical bytes");
    const unknownKey = storageKey(session);
    await writeFile(join(root, unknownKey), "unreferenced bytes");
    await mkdir(
      join(
        root,
        `workspaces/${session.workspace.id}/documents/unknown-directory`,
      ),
    );
    const snapshot = async () => ({
      objects: await db.select().from(objects).orderBy(objects.id),
      documents: await db.select().from(documents).orderBy(documents.objectId),
      transfers: await db
        .select()
        .from(documentTransferAuthorizations)
        .orderBy(documentTransferAuthorizations.id),
      revisions: await db
        .select()
        .from(objectRevisions)
        .orderBy(objectRevisions.id),
      audits: await db.select().from(auditEvents).orderBy(auditEvents.id),
    });
    const before = await snapshot();
    const response = await request(session);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(storageInventoryResponseSchema.parse(response.json())).toMatchObject(
      {
        consistency: "observational",
        retentionPolicy: "retain-all",
        references: {
          canonical: 4,
          historicalOnly: 1,
          missingCanonical: 0,
          missingHistoricalOnly: 0,
        },
        entries: {
          canonical: 4,
          historicalOnly: 1,
          pendingUpload: 0,
          expiredUpload: 0,
          unreferenced: 1,
          unsupported: 1,
        },
      },
    );
    expect(await snapshot()).toEqual(before);
    for (const document of before.documents)
      expect(await readFile(join(root, document.storageKey), "utf8")).toBe(
        "private document bytes",
      );
    expect(await readFile(join(root, historicalKey), "utf8")).toBe(
      "historical bytes",
    );
    expect(await readFile(join(root, unknownKey), "utf8")).toBe(
      "unreferenced bytes",
    );
    for (const secret of [
      live.document.id,
      historicalKey,
      unknownKey,
      "private.txt",
      "private document bytes",
    ])
      expect(response.body).not.toContain(secret);
  });

  it("distinguishes unused expiry from consumed uploads that can still finalize", async () => {
    const session = await signIn();
    const event = await createEvent(session);
    const consumed = await authorizeUpload(session, event.id);
    await uploadBytes(consumed);
    const unused = await authorizeUpload(session, event.id);
    const [transfer] = await database.connection.db
      .select()
      .from(documentTransferAuthorizations)
      .where(eq(documentTransferAuthorizations.id, unused.id));
    if (!transfer) throw new Error("Missing upload fixture");
    await writeFile(join(root, transfer.storageKey), unused.bytes);
    currentTime = new Date(currentTime.getTime() + 60_000);
    const active = await authorizeUpload(session, event.id);
    const [activeTransfer] = await database.connection.db
      .select()
      .from(documentTransferAuthorizations)
      .where(eq(documentTransferAuthorizations.id, active.id));
    if (!activeTransfer) throw new Error("Missing upload fixture");
    await writeFile(join(root, activeTransfer.storageKey), active.bytes);
    expect(
      storageInventoryResponseSchema.parse((await request(session)).json())
        .entries,
    ).toEqual({
      canonical: 0,
      historicalOnly: 0,
      pendingUpload: 2,
      expiredUpload: 1,
      unreferenced: 0,
      unsupported: 0,
    });
    await finalize(session, consumed.id);
    expect(
      storageInventoryResponseSchema.parse((await request(session)).json())
        .entries,
    ).toMatchObject({ canonical: 1, pendingUpload: 1, expiredUpload: 1 });
    expect(
      (
        await request(session, {
          method: "POST",
          url: "/api/documents",
          payload: { uploadAuthorizationId: unused.id },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("reports missing files without counting another provider or workspace", async () => {
    const session = await signIn();
    const attachment = await attach(session, (await createEvent(session)).id);
    await appendRevision(attachment.document.id, {
      storageKey: storageKey(session),
    });
    const [document] = await database.connection.db
      .select()
      .from(documents)
      .where(eq(documents.objectId, attachment.document.id));
    if (!document) throw new Error("Missing document fixture");
    await rm(join(root, document.storageKey));
    const other = await signIn("other@example.com");
    await attach(other, (await createEvent(other)).id);
    await appendRevision(attachment.document.id, {
      storageProvider: "other-provider",
      storageKey: storageKey(session),
    });
    const response = await request(session);
    expect(response.statusCode).toBe(200);
    expect(storageInventoryResponseSchema.parse(response.json())).toMatchObject(
      {
        references: {
          canonical: 1,
          historicalOnly: 1,
          missingCanonical: 1,
          missingHistoricalOnly: 1,
        },
        entries: { canonical: 0, historicalOnly: 0, unreferenced: 0 },
      },
    );
  });

  it("counts a file in the workspace whose records name it, whichever prefix holds it", async () => {
    const origin = await signIn();
    const destination = await signIn("other@example.com");
    await attach(origin, (await createEvent(origin)).id);
    const { document: movedKey, upload: uploadKey } =
      await moveRecordsWithFiles(origin, destination);
    const orphanKey = storageKey(origin);
    for (const key of [movedKey, uploadKey, orphanKey])
      await writeFile(join(root, key), "stored bytes");
    const list = vi.spyOn(provider, "listObjects");
    const report = async (session: Session) => {
      const response = await request(session);
      expect(response.statusCode).toBe(200);
      return response;
    };

    const originReport = await report(origin);
    expect(
      storageInventoryResponseSchema.parse(originReport.json()),
    ).toMatchObject({
      references: {
        canonical: 1,
        historicalOnly: 0,
        missingCanonical: 0,
        missingHistoricalOnly: 0,
      },
      entries: {
        canonical: 1,
        historicalOnly: 0,
        pendingUpload: 0,
        expiredUpload: 0,
        unreferenced: 1,
        unsupported: 0,
      },
    });
    for (const secret of [destination.workspace.id, movedKey, uploadKey])
      expect(originReport.body).not.toContain(secret);
    expect(
      storageInventoryResponseSchema.parse((await report(destination)).json()),
    ).toMatchObject({
      references: {
        canonical: 1,
        historicalOnly: 0,
        missingCanonical: 0,
        missingHistoricalOnly: 0,
      },
      entries: {
        canonical: 1,
        historicalOnly: 0,
        pendingUpload: 1,
        expiredUpload: 0,
        unreferenced: 0,
        unsupported: 0,
      },
    });
    const originPrefix = `workspaces/${origin.workspace.id}/documents`;
    expect(list.mock.calls.map(([prefix]) => prefix)).toEqual([
      originPrefix,
      `workspaces/${destination.workspace.id}/documents`,
      originPrefix,
    ]);

    await rm(join(root, movedKey));
    expect(
      storageInventoryResponseSchema.parse((await report(destination)).json()),
    ).toMatchObject({
      references: { canonical: 1, missingCanonical: 1 },
      entries: { canonical: 0, pendingUpload: 1, unreferenced: 0 },
    });
    expect(
      storageInventoryResponseSchema.parse((await report(origin)).json())
        .entries,
    ).toMatchObject({ canonical: 1, unreferenced: 1 });
    expect(await readFile(join(root, uploadKey), "utf8")).toBe("stored bytes");
  });

  it("denies anonymous, cross-workspace, shared object owners, editors, and viewers before enumeration", async () => {
    const owner = await signIn();
    const other = await signIn("other@example.com");
    const event = await createEvent(owner);
    const list = vi.spyOn(provider, "listObjects");
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/workspace/storage-inventory",
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await request(other, undefined, owner.workspace.id)).statusCode,
    ).toBe(404);
    await seedOwnerGrant(database.connection.db, {
      workspaceId: owner.workspace.id,
      resourceId: event.id,
      principalEmail: "other@example.com",
      grantedBy: owner.user.id,
    });
    expect(
      (await request(other, undefined, owner.workspace.id)).statusCode,
    ).toBe(404);
    for (const role of ["editor", "viewer"] as const) {
      await database.connection.db
        .insert(workspaceMembers)
        .values({
          workspaceId: owner.workspace.id,
          userId: other.user.id,
          role,
        })
        .onConflictDoUpdate({
          target: [workspaceMembers.workspaceId, workspaceMembers.userId],
          set: { role },
        });
      expect(
        (await request(other, undefined, owner.workspace.id)).statusCode,
      ).toBe(404);
    }
    expect(list).not.toHaveBeenCalled();
    expect(
      (
        await request(owner, {
          method: "GET",
          url: "/api/workspace/storage-inventory?workspaceId=untrusted",
        })
      ).statusCode,
    ).toBe(400);
  });

  it("rechecks workspace ownership after storage I/O", async () => {
    const session = await signIn();
    vi.spyOn(provider, "listObjects").mockImplementation(async function* () {
      await database.connection.db
        .update(workspaceMembers)
        .set({ role: "viewer" })
        .where(
          and(
            eq(workspaceMembers.workspaceId, session.workspace.id),
            eq(workspaceMembers.userId, session.user.id),
          ),
        );
      yield { storageKey: storageKey(session), kind: "file" };
    });
    const response = await request(session);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: "resource_unavailable" },
    });
  });

  it("keeps reference classification in the authorization snapshot during finalization", async () => {
    const session = await signIn();
    const event = await createEvent(session);
    const upload = await authorizeUpload(session, event.id);
    await uploadBytes(upload);
    const assertOwner = AuthorizationService.prototype.assertWorkspaceOwner;
    let checks = 0;
    vi.spyOn(
      AuthorizationService.prototype,
      "assertWorkspaceOwner",
    ).mockImplementation(async function (this: AuthorizationService, caller) {
      await assertOwner.call(this, caller);
      if (++checks === 2) await finalize(session, upload.id);
    });

    const response = await request(session);
    expect(response.statusCode).toBe(200);
    expect(checks).toBe(3);
    expect(storageInventoryResponseSchema.parse(response.json())).toMatchObject(
      {
        references: { canonical: 0, historicalOnly: 0 },
        entries: { canonical: 0, pendingUpload: 1 },
      },
    );
    const refreshed = await request(session);
    expect(refreshed.statusCode).toBe(200);
    expect(
      storageInventoryResponseSchema.parse(refreshed.json()),
    ).toMatchObject({
      references: { canonical: 1, historicalOnly: 0 },
      entries: { canonical: 1, pendingUpload: 0 },
    });
  });

  it("closes the read-only reference transaction before enumerating storage", async () => {
    const session = await signIn();
    const db = database.connection.db;
    const transaction = db.transaction.bind(db);
    let isTransactionOpen = false;
    let transactionSettings: unknown;
    vi.spyOn(db, "transaction").mockImplementation(
      async (operation, config) => {
        isTransactionOpen = true;
        try {
          return await transaction(async (scope) => {
            const value = await operation(scope);
            [transactionSettings] = await scope.execute(sql`
              select current_setting('transaction_isolation') as isolation,
                     current_setting('transaction_read_only') as read_only,
                     current_setting('statement_timeout') as timeout
            `);
            return value;
          }, config);
        } finally {
          isTransactionOpen = false;
        }
      },
    );
    const list = vi
      .spyOn(provider, "listObjects")
      .mockImplementation(async function* () {
        expect(isTransactionOpen).toBe(false);
        yield { storageKey: storageKey(session), kind: "file" };
      });
    const inventory = await new StorageInventoryService(db, provider).get(
      principal(session),
    );
    expect(transactionSettings).toEqual({
      isolation: "repeatable read",
      read_only: "on",
      timeout: "5s",
    });
    expect(list).toHaveBeenCalledOnce();
    expect(inventory.entries.unreferenced).toBe(1);
  });

  it.each([
    { patch: {}, version: 2 },
    { patch: { storageKey: null }, version: 1 },
    { patch: { storageKey: "workspaces/other/documents/unknown" }, version: 1 },
    { patch: { storageProvider: { unsupported: true } }, version: 1 },
  ])(
    "rejects unreadable document history before scanning: %j",
    async ({ patch, version }) => {
      const session = await signIn();
      const attachment = await attach(session, (await createEvent(session)).id);
      await appendRevision(attachment.document.id, patch, version);
      const list = vi.spyOn(provider, "listObjects");
      const response = await request(session);
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        error: { code: "inventory_unavailable" },
      });
      expect(list).not.toHaveBeenCalled();
    },
  );

  it("fails closed for unsupported providers and storage failures without exposing details", async () => {
    const session = await signIn();
    const storage: StorageProvider = {
      providerId: "remote",
      encryptionMode: "provider",
      createDownloadAuthorization: vi.fn(),
      createUploadAuthorization: vi.fn(),
      inspectObject: vi.fn(),
    };
    await expect(
      new StorageInventoryService(database.connection.db, storage).get(
        principal(session),
      ),
    ).rejects.toMatchObject({ name: "StorageInventoryUnavailableError" });
    vi.spyOn(provider, "listObjects").mockImplementation(async function* () {
      yield { storageKey: storageKey(session), kind: "file" };
      throw new Error("private/path credential=secret");
    });
    const response = await request(session);
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("private/path");
    expect(response.body).not.toContain("secret");
    expect(response.body).not.toContain("entries");
  });

  it("bounds reference sets and enumeration without returning partial counts", async () => {
    const session = await signIn();
    const event = await createEvent(session);
    await attach(session, event.id);
    await attach(session, event.id);
    const list = vi.spyOn(provider, "listObjects");
    const limited = new StorageInventoryService(
      database.connection.db,
      provider,
      { maximumEntries: 1 },
    );
    await expect(limited.get(principal(session))).rejects.toMatchObject({
      name: "StorageInventoryUnavailableError",
    });
    expect(list).not.toHaveBeenCalled();
    const other = await signIn("other@example.com");
    let closed = false;
    list.mockImplementation(async function* () {
      try {
        yield { storageKey: storageKey(other), kind: "file" };
        yield { storageKey: storageKey(other), kind: "file" };
      } finally {
        closed = true;
      }
    });
    await expect(limited.get(principal(other))).rejects.toMatchObject({
      name: "StorageInventoryUnavailableError",
    });
    expect(closed).toBe(true);
    list.mockRestore();
    await expect(limited.get(principal(other))).resolves.toMatchObject({
      entries: { unreferenced: 0 },
    });
  });

  it("limits concurrent scans and releases the workspace slot after completion", async () => {
    const session = await signIn();
    const second = await signIn("second@example.com");
    const third = await signIn("third@example.com");
    const release = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    let running = 0;
    vi.spyOn(provider, "listObjects").mockImplementation(
      async function* (prefix) {
        if (++running === 2) entered.resolve();
        await release.promise;
        yield { storageKey: `${prefix}/${createId()}`, kind: "file" };
      },
    );
    const completed = Promise.all([request(session), request(second)]);
    await entered.promise;
    try {
      for (const denied of [session, third]) {
        const response = await request(denied);
        expect(response.statusCode).toBe(429);
        expect(response.json()).toMatchObject({
          error: { code: "inventory_busy" },
        });
      }
    } finally {
      release.resolve();
    }
    expect((await completed).map((response) => response.statusCode)).toEqual([
      200, 200,
    ]);
    expect((await request(session)).statusCode).toBe(200);
  });

  it("fails a cancelled enumeration and keeps an empty inventory read-only", async () => {
    const session = await signIn();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(AbortSignal.abort());
    expect((await request(session)).statusCode).toBe(503);
    timeout.mockRestore();
    expect((await request(session)).statusCode).toBe(200);
    expect(await readdir(root)).toEqual([]);
  });
});
