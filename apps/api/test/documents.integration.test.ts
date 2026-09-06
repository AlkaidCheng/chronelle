import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  auditEvents,
  objectRevisions,
  objects,
  documents,
  documentTransferAuthorizations,
} from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  apiErrorResponseSchema,
  developmentSignInResponseSchema,
  documentAttachmentListResponseSchema,
  documentAttachmentResponseSchema,
  documentDownloadAuthorizationResponseSchema,
  documentUploadAuthorizationResponseSchema,
  eventDetailResponseSchema,
  eventResponseSchema,
  expenseResponseSchema,
  relationDeletionResponseSchema,
  shareResponseSchema,
  taskResponseSchema,
  maximumDocumentSizeBytes,
} from "@chronelle/schemas";
import { and, eq, like } from "drizzle-orm";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { createDevelopmentAppDependencies } from "../src/dependencies.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);

let testDatabase: TestDatabase;
let app: FastifyInstance;
let storageRoot: string;
let currentTime: Date;
let testResourcesReady = false;

beforeEach(async () => {
  testResourcesReady = false;
  storageRoot = await mkdtemp(join(tmpdir(), "chronelle-documents-"));
  currentTime = new Date("2026-10-01T12:00:00Z");
  testDatabase = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: testDatabase.databaseUrl },
    migrationDirectory,
  );
  app = buildApp(
    createDevelopmentAppDependencies(testDatabase.connection, {
      clock: () => currentTime,
      documentTransferTtlMs: 60_000,
      localStorageRoot: storageRoot,
    }),
  );
  testResourcesReady = true;
});

afterEach(async () => {
  try {
    if (testResourcesReady) {
      await app.close();
      await testDatabase.close();
    }
  } finally {
    testResourcesReady = false;
    await rm(storageRoot, { force: true, recursive: true });
  }
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

function headers(
  session: Awaited<ReturnType<typeof signIn>>,
  workspaceId = session.workspace.id,
) {
  return {
    authorization: `Bearer ${session.accessToken}`,
    "x-workspace-id": workspaceId,
  };
}

async function request(
  session: Awaited<ReturnType<typeof signIn>>,
  workspaceId: string,
  options: Omit<InjectOptions, "headers">,
) {
  return app.inject({ ...options, headers: headers(session, workspaceId) });
}

function fileMetadata(bytes: Buffer, originalFilename: string) {
  return {
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    mimeType: "application/pdf",
    originalFilename,
    sizeBytes: bytes.byteLength,
  };
}

async function attachFile(
  session: Awaited<ReturnType<typeof signIn>>,
  workspaceId: string,
  parentObjectId: string,
  originalFilename: string,
) {
  const bytes = Buffer.from(`private:${originalFilename}`);
  const authorizationResponse = await request(session, workspaceId, {
    method: "POST",
    url: "/api/documents/upload-url",
    payload: { parentObjectId, ...fileMetadata(bytes, originalFilename) },
  });
  expect(authorizationResponse.statusCode).toBe(201);
  const authorization = documentUploadAuthorizationResponseSchema.parse(
    authorizationResponse.json(),
  );
  expect(authorization.upload.url).toMatch(
    /^\/api\/document-transfers\/upload\/[A-Za-z0-9_-]+$/,
  );
  expect(JSON.stringify(authorization)).not.toContain("storageKey");

  const uploadResponse = await app.inject({
    method: "PUT",
    url: authorization.upload.url,
    headers: authorization.upload.headers,
    payload: bytes,
  });
  expect(uploadResponse.statusCode).toBe(204);

  const replayResponse = await app.inject({
    method: "PUT",
    url: authorization.upload.url,
    headers: authorization.upload.headers,
    payload: bytes,
  });
  expect(replayResponse.statusCode).toBe(404);

  const finalizationResponse = await request(session, workspaceId, {
    method: "POST",
    url: "/api/documents",
    payload: { uploadAuthorizationId: authorization.id },
  });
  expect(finalizationResponse.statusCode).toBe(201);
  return {
    attachment: documentAttachmentResponseSchema.parse(
      finalizationResponse.json(),
    ),
    bytes,
  };
}

describe.sequential("document attachment API", () => {
  it("rejects oversized bytes without consuming the upload credential or writing storage and ledgers", async () => {
    const owner = await signIn("owner@example.com", "Owner");
    const event = eventResponseSchema.parse(
      (
        await request(owner, owner.workspace.id, {
          method: "POST",
          url: "/api/events",
          payload: { displayName: "File limit" },
        })
      ).json(),
    );
    const authorization = documentUploadAuthorizationResponseSchema.parse(
      (
        await request(owner, owner.workspace.id, {
          method: "POST",
          url: "/api/documents/upload-url",
          payload: {
            parentObjectId: event.id,
            ...fileMetadata(Buffer.alloc(0), "empty.pdf"),
          },
        })
      ).json(),
    );
    const db = testDatabase.connection.db;
    const beforeTransfers = await db
      .select()
      .from(documentTransferAuthorizations);
    const beforeAudit = await db.select().from(auditEvents);
    const response = await app.inject({
      method: "PUT",
      url: authorization.upload.url,
      headers: authorization.upload.headers,
      payload: Buffer.alloc(maximumDocumentSizeBytes + 1),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      error: { code: "payload_too_large" },
    });
    expect(await db.select().from(documentTransferAuthorizations)).toEqual(
      beforeTransfers,
    );
    expect(await db.select().from(auditEvents)).toEqual(beforeAudit);
    expect(await db.select().from(documents)).toEqual([]);
    expect(await readdir(storageRoot)).toEqual([]);
  });

  it("accepts the maximum attachment size and finalizes its canonical metadata", async () => {
    const owner = await signIn("owner@example.com", "Owner");
    const event = eventResponseSchema.parse(
      (
        await request(owner, owner.workspace.id, {
          method: "POST",
          url: "/api/events",
          payload: { displayName: "Large attachment" },
        })
      ).json(),
    );
    const bytes = Buffer.alloc(maximumDocumentSizeBytes, 7);
    const metadata = fileMetadata(bytes, "large.pdf");
    const authorization = documentUploadAuthorizationResponseSchema.parse(
      (
        await request(owner, owner.workspace.id, {
          method: "POST",
          url: "/api/documents/upload-url",
          payload: { parentObjectId: event.id, ...metadata },
        })
      ).json(),
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
    const finalized = await request(owner, owner.workspace.id, {
      method: "POST",
      url: "/api/documents",
      payload: { uploadAuthorizationId: authorization.id },
    });
    expect(finalized.statusCode).toBe(201);
    expect(
      documentAttachmentResponseSchema.parse(finalized.json()).document,
    ).toMatchObject({
      sizeBytes: String(maximumDocumentSizeBytes),
      checksumSha256: metadata.checksumSha256,
    });
  });
  it("recovers private file identity and independently removed attachment links", async () => {
    const owner = await signIn("owner@example.com", "Owner");
    const stranger = await signIn("stranger@example.com", "Stranger");
    const event = eventResponseSchema.parse(
      (
        await request(owner, owner.workspace.id, {
          method: "POST",
          url: "/api/events",
          payload: { displayName: "Context" },
        })
      ).json(),
    );
    const { attachment, bytes } = await attachFile(
      owner,
      owner.workspace.id,
      event.id,
      "recovery.pdf",
    );
    const document = attachment.document;
    const originalDownload = documentDownloadAuthorizationResponseSchema.parse(
      (
        await request(owner, owner.workspace.id, {
          url: `/api/documents/${document.id}/download-url`,
        })
      ).json(),
    );
    expect(
      (
        await request(owner, owner.workspace.id, {
          method: "DELETE",
          url: `/api/relations/${attachment.relationId}?expectedVersion=1`,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request(owner, owner.workspace.id, {
          method: "DELETE",
          url: `/api/objects/${document.id}?expectedVersion=1`,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request(owner, owner.workspace.id, {
          url: `/api/documents/${document.id}/download-url`,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: originalDownload.download.url })).statusCode,
    ).toBe(404);
    expect(
      (
        await request(stranger, owner.workspace.id, {
          url: `/api/objects/${document.id}/recovery-preview`,
        })
      ).statusCode,
    ).not.toBe(200);
    const recovered = await request(owner, owner.workspace.id, {
      method: "POST",
      url: `/api/objects/${document.id}/recover`,
      payload: { expectedVersion: 2 },
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({
      ...document,
      version: 3,
      updatedAt: expect.any(String),
    });
    expect(recovered.body).not.toContain("storageKey");
    const attachments = await request(owner, owner.workspace.id, {
      url: `/api/objects/${event.id}/documents`,
    });
    expect(attachments.json().items).toEqual([]);
    const removed = await request(owner, owner.workspace.id, {
      url: `/api/objects/${event.id}/removed-relations`,
    });
    expect(removed.json().items).toMatchObject([
      { relation: { id: attachment.relationId, version: 2 } },
    ]);
    expect(
      (
        await request(owner, owner.workspace.id, {
          method: "POST",
          url: `/api/relations/${attachment.relationId}/recover`,
          payload: { expectedVersion: 2 },
        })
      ).statusCode,
    ).toBe(200);
    const download = documentDownloadAuthorizationResponseSchema.parse(
      (
        await request(owner, owner.workspace.id, {
          url: `/api/documents/${document.id}/download-url`,
        })
      ).json(),
    );
    expect(
      (await app.inject({ url: download.download.url })).rawPayload,
    ).toEqual(bytes);
    expect(
      (
        await request(stranger, owner.workspace.id, {
          url: `/api/documents/${document.id}/download-url`,
        })
      ).statusCode,
    ).not.toBe(200);
  });

  it("restores a Document caption without replaying its scope or file identity", async () => {
    const owner = await signIn("owner@example.com", "Owner");
    const eventResponse = await request(owner, owner.workspace.id, {
      method: "POST",
      url: "/api/events",
      payload: { displayName: "Context" },
    });
    const event = eventResponseSchema.parse(eventResponse.json());
    const { attachment } = await attachFile(
      owner,
      owner.workspace.id,
      event.id,
      "original.pdf",
    );
    const document = attachment.document;
    // Seed a later content state before a versioned scope mutation captures it.
    await testDatabase.connection.db
      .update(objects)
      .set({ displayName: "Current caption" })
      .where(eq(objects.id, document.id));
    await testDatabase.connection.db
      .update(documents)
      .set({
        storageKey: "private/current.pdf",
        originalFilename: "current.pdf",
      })
      .where(eq(documents.objectId, document.id));
    const scope = await request(owner, owner.workspace.id, {
      method: "PATCH",
      url: `/api/objects/${document.id}/permission-scope`,
      payload: { expectedVersion: 1, permissionScopeId: document.id },
    });
    expect(scope.statusCode).toBe(200);
    const preview = await request(owner, owner.workspace.id, {
      url: `/api/objects/${document.id}/revisions/1/restore-preview`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.body).not.toContain("private/current.pdf");
    expect(preview.body).not.toContain("storageKey");
    const restored = await request(owner, owner.workspace.id, {
      method: "POST",
      url: `/api/objects/${document.id}/revisions/1/restore`,
      payload: { expectedVersion: 2 },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      id: document.id,
      displayName: "original.pdf",
      originalFilename: "current.pdf",
      permissionScopeId: document.id,
      version: 3,
    });
    const [file] = await testDatabase.connection.db
      .select()
      .from(documents)
      .where(eq(documents.objectId, document.id));
    expect(file?.storageKey).toBe("private/current.pdf");
    expect(restored.body).not.toContain("storageKey");
  });
  it("serves canonical private attachments through inherited permissions", async () => {
    const owner = await signIn("owner@example.com", "Event Owner");
    const viewer = await signIn("viewer@example.com", "Event Viewer");
    const unrelated = await signIn("unrelated@example.com", "Other User");
    const workspaceId = owner.workspace.id;

    const eventResponse = await request(owner, workspaceId, {
      method: "POST",
      url: "/api/events",
      payload: { displayName: "Launch event" },
    });
    const event = eventResponseSchema.parse(eventResponse.json());
    const taskResponse = await request(owner, workspaceId, {
      method: "POST",
      url: "/api/tasks",
      payload: {
        displayName: "Confirm venue",
        permissionScopeId: event.id,
      },
    });
    const task = taskResponseSchema.parse(taskResponse.json());
    const expenseResponse = await request(owner, workspaceId, {
      method: "POST",
      url: "/api/expenses",
      payload: {
        amount: "500.0000",
        currency: "USD",
        displayName: "Venue deposit",
        occurredAt: "2026-09-15T12:00:00Z",
        permissionScopeId: event.id,
      },
    });
    const expense = expenseResponseSchema.parse(expenseResponse.json());

    for (const targetObjectId of [task.id, expense.id]) {
      const relationResponse = await request(owner, workspaceId, {
        method: "POST",
        url: `/api/objects/${event.id}/relations`,
        payload: { relationType: "includes", targetObjectId },
      });
      expect(relationResponse.statusCode).toBe(201);
    }
    const shareResponse = await request(owner, workspaceId, {
      method: "POST",
      url: "/api/shares",
      payload: {
        principalEmail: "viewer@example.com",
        resourceId: event.id,
        role: "viewer",
      },
    });
    expect(shareResponse.statusCode).toBe(201);
    shareResponseSchema.parse(shareResponse.json());

    const eventFile = await attachFile(
      owner,
      workspaceId,
      event.id,
      "run-of-show.pdf",
    );
    const taskFile = await attachFile(
      owner,
      workspaceId,
      task.id,
      "venue-terms.pdf",
    );
    const expenseFile = await attachFile(
      owner,
      workspaceId,
      expense.id,
      "deposit-receipt.pdf",
    );
    expect(taskFile.attachment.document.permissionScopeId).toBe(event.id);
    expect(expenseFile.attachment.document.permissionScopeId).toBe(event.id);

    const documentId = eventFile.attachment.document.id;
    const [revision] = await testDatabase.connection.db
      .select()
      .from(objectRevisions)
      .where(eq(objectRevisions.objectId, documentId));
    expect(revision).toMatchObject({
      mutationKind: "created",
      objectVersion: 1,
      snapshotSchemaVersion: 1,
    });
    expect(revision?.snapshot.storageKey).toEqual(expect.any(String));
    expect(revision?.snapshot.sizeBytes).toBe(
      eventFile.attachment.document.sizeBytes,
    );
    const history = await request(viewer, workspaceId, {
      method: "GET",
      url: `/api/objects/${documentId}/revisions/1`,
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().snapshot).toMatchObject({
      id: documentId,
      sizeBytes: eventFile.attachment.document.sizeBytes,
    });
    for (const field of [
      "storageKey",
      "storageProvider",
      "metadata",
      "permissionScopeId",
      "encryptionMode",
    ])
      expect(history.json().snapshot).not.toHaveProperty(field);
    const deniedHistory = await request(unrelated, workspaceId, {
      method: "GET",
      url: `/api/objects/${documentId}/revisions/1`,
    });
    expect(deniedHistory.statusCode).toBe(404);

    const detailResponse = await request(owner, workspaceId, {
      method: "GET",
      url: `/api/events/${event.id}/detail`,
    });
    expect(
      eventDetailResponseSchema
        .parse(detailResponse.json())
        .documents.map((document) => document.id),
    ).toEqual([eventFile.attachment.document.id]);

    for (const parentObjectId of [event.id, task.id, expense.id]) {
      const ownerListResponse = await request(owner, workspaceId, {
        method: "GET",
        url: `/api/objects/${parentObjectId}/documents`,
      });
      const viewerListResponse = await request(viewer, workspaceId, {
        method: "GET",
        url: `/api/objects/${parentObjectId}/documents`,
      });
      expect(
        documentAttachmentListResponseSchema.parse(ownerListResponse.json())
          .items,
      ).toHaveLength(1);
      expect(
        documentAttachmentListResponseSchema.parse(viewerListResponse.json())
          .items,
      ).toHaveLength(1);
    }

    const downloadAuthorizationResponse = await request(viewer, workspaceId, {
      method: "GET",
      url: `/api/documents/${eventFile.attachment.document.id}/download-url`,
    });
    expect(downloadAuthorizationResponse.statusCode).toBe(200);
    const downloadAuthorization =
      documentDownloadAuthorizationResponseSchema.parse(
        downloadAuthorizationResponse.json(),
      );
    expect(downloadAuthorization.download.url).toMatch(
      /^\/api\/document-transfers\/download\/[A-Za-z0-9_-]+$/,
    );

    const unrelatedDownloadResponse = await request(unrelated, workspaceId, {
      method: "GET",
      url: `/api/documents/${eventFile.attachment.document.id}/download-url`,
    });
    expect(unrelatedDownloadResponse.statusCode).toBe(404);

    const downloadResponse = await app.inject({
      method: "GET",
      url: downloadAuthorization.download.url,
    });
    expect(downloadResponse.statusCode).toBe(200);
    expect(downloadResponse.rawPayload).toEqual(eventFile.bytes);
    expect(downloadResponse.headers["cache-control"]).toBe("private, no-store");
    expect(downloadResponse.headers["content-disposition"]).toContain(
      "run-of-show.pdf",
    );

    const replayDownloadResponse = await app.inject({
      method: "GET",
      url: downloadAuthorization.download.url,
    });
    expect(replayDownloadResponse.statusCode).toBe(404);

    const viewerUploadResponse = await request(viewer, workspaceId, {
      method: "POST",
      url: "/api/documents/upload-url",
      payload: {
        parentObjectId: event.id,
        ...fileMetadata(Buffer.from("denied"), "denied.pdf"),
      },
    });
    expect(viewerUploadResponse.statusCode).toBe(404);

    const viewerUnlinkResponse = await request(viewer, workspaceId, {
      method: "DELETE",
      url: `/api/relations/${eventFile.attachment.relationId}?expectedVersion=${eventFile.attachment.relationVersion}`,
    });
    expect(viewerUnlinkResponse.statusCode).toBe(404);

    const unlinkResponse = await request(owner, workspaceId, {
      method: "DELETE",
      url: `/api/relations/${eventFile.attachment.relationId}?expectedVersion=${eventFile.attachment.relationVersion}`,
    });
    expect(unlinkResponse.statusCode).toBe(200);
    relationDeletionResponseSchema.parse(unlinkResponse.json());

    const unlinkedListResponse = await request(owner, workspaceId, {
      method: "GET",
      url: `/api/objects/${event.id}/documents`,
    });
    expect(
      documentAttachmentListResponseSchema.parse(unlinkedListResponse.json())
        .items,
    ).toEqual([]);
    const canonicalDocumentResponse = await request(owner, workspaceId, {
      method: "GET",
      url: `/api/objects/${eventFile.attachment.document.id}`,
    });
    expect(canonicalDocumentResponse.statusCode).toBe(200);
    expect(canonicalDocumentResponse.json()).toMatchObject({
      id: eventFile.attachment.document.id,
      objectType: "document",
    });
    expect(canonicalDocumentResponse.json()).not.toHaveProperty("storageKey");

    const documentAuditActions = (
      await testDatabase.connection.db
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.workspaceId, workspaceId),
            like(auditEvents.action, "document.%"),
          ),
        )
    ).map(({ action }) => action);
    expect(documentAuditActions).toEqual(
      expect.arrayContaining([
        "document.upload_authorized",
        "document.uploaded",
        "document.created",
        "document.download_authorized",
        "document.downloaded",
      ]),
    );
  });

  it("rejects expired, incomplete, mismatched, and traversal uploads", async () => {
    const owner = await signIn("planner@example.com", "Event Planner");
    const eventResponse = await request(owner, owner.workspace.id, {
      method: "POST",
      url: "/api/events",
      payload: { displayName: "Private event" },
    });
    const event = eventResponseSchema.parse(eventResponse.json());
    const bytes = Buffer.from("expected bytes");
    const authorizationResponse = await request(owner, owner.workspace.id, {
      method: "POST",
      url: "/api/documents/upload-url",
      payload: {
        parentObjectId: event.id,
        ...fileMetadata(bytes, "brief.pdf"),
      },
    });
    const authorization = documentUploadAuthorizationResponseSchema.parse(
      authorizationResponse.json(),
    );

    const prematureFinalizationResponse = await request(
      owner,
      owner.workspace.id,
      {
        method: "POST",
        url: "/api/documents",
        payload: { uploadAuthorizationId: authorization.id },
      },
    );
    expect(prematureFinalizationResponse.statusCode).toBe(404);

    const mismatchedResponse = await app.inject({
      method: "PUT",
      url: authorization.upload.url,
      headers: authorization.upload.headers,
      payload: Buffer.from("different"),
    });
    expect(mismatchedResponse.statusCode).toBe(400);

    currentTime = new Date(currentTime.getTime() + 61_000);
    const expiredResponse = await app.inject({
      method: "PUT",
      url: authorization.upload.url,
      headers: authorization.upload.headers,
      payload: bytes,
    });
    expect(expiredResponse.statusCode).toBe(404);
    expect(apiErrorResponseSchema.parse(expiredResponse.json())).toMatchObject({
      error: { code: "transfer_unavailable" },
    });

    const traversalResponse = await app.inject({
      method: "PUT",
      url: "/api/document-transfers/upload/..%2F..%2Fsecret",
      headers: { "content-type": "application/octet-stream" },
      payload: bytes,
    });
    expect(traversalResponse.statusCode).toBeGreaterThanOrEqual(400);
  });
});
