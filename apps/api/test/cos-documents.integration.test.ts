import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  auditEvents,
  createId,
  documents,
  documentTransferAuthorizations,
  objectRevisions,
  workspaceMembers,
} from "@livtales/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import {
  developmentSignInResponseSchema,
  documentAttachmentResponseSchema,
  documentDownloadAuthorizationResponseSchema,
  documentUploadAuthorizationResponseSchema,
  eventDetailResponseSchema,
  eventResponseSchema,
  shareResponseSchema,
  storageInventoryResponseSchema,
} from "@livtales/schemas";
import COS from "cos-nodejs-sdk-v5";
import { eq, like } from "drizzle-orm";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { createDevelopmentAppDependencies } from "../src/dependencies.js";
import { createDocumentStorage } from "../src/documents/storage-configuration.js";

const bytes = new Uint8Array([0, 255, 128, 10]);
const metadata = {
  sizeBytes: bytes.length,
  checksumSha256: createHash("sha256").update(bytes).digest("hex"),
  originalFilename: "private-receipt.pdf",
  mimeType: "application/pdf",
};
let database: TestDatabase | undefined;
let app: FastifyInstance | undefined;
let currentTime: Date;
let ownerHeaders: Record<string, string>;
let viewerHeaders: Record<string, string>;
let eventId: string;
let content: Map<string, Uint8Array>;
const inspection = vi.fn<typeof fetch>();

function testDb() {
  if (database === undefined) throw new Error("Test database is unavailable.");
  return database.connection.db;
}

async function request(options: InjectOptions, headers = ownerHeaders) {
  if (app === undefined) throw new Error("Test API is unavailable.");
  return app.inject({ ...options, headers });
}

async function signIn(email: string) {
  const response = await request(
    {
      method: "POST",
      url: "/api/auth/development/sign-in",
      payload: { email, displayName: "Document tester" },
    },
    {},
  );
  expect(response.statusCode).toBe(200);
  return developmentSignInResponseSchema.parse(response.json());
}

async function share(role: "viewer" | "editor") {
  const response = await request({
    method: "POST",
    url: "/api/shares",
    payload: {
      resourceId: eventId,
      principalEmail: "viewer@example.com",
      role,
    },
  });
  expect(response.statusCode).toBe(201);
  return shareResponseSchema.parse(response.json());
}

async function authorize(headers = ownerHeaders) {
  const response = await request(
    {
      method: "POST",
      url: "/api/documents/upload-url",
      payload: { parentObjectId: eventId, ...metadata },
    },
    headers,
  );
  expect(response.statusCode).toBe(201);
  return documentUploadAuthorizationResponseSchema.parse(response.json());
}

function finalize(id: string, headers = ownerHeaders) {
  return request(
    {
      method: "POST",
      url: "/api/documents",
      payload: { uploadAuthorizationId: id },
    },
    headers,
  );
}

async function listStoredKeys(
  parameters: COS.GetBucketParams,
): Promise<COS.GetBucketResult> {
  const prefix = parameters.Prefix ?? "";
  return {
    statusCode: 200,
    headers: {},
    Name: parameters.Bucket,
    Prefix: encodeURIComponent(prefix),
    Marker: encodeURIComponent(parameters.Marker ?? ""),
    Delimiter: "%2F",
    EncodingType: "url",
    MaxKeys: "1000",
    IsTruncated: "false",
    Contents: [...content.entries()]
      .filter(([key]) => key.startsWith(`/${prefix}`))
      .map(([key, stored]) => ({
        Key: encodeURIComponent(key.slice(1)),
        LastModified: currentTime.toISOString(),
        ETag: '"fixture"',
        Size: String(stored.length),
        StorageClass: "STANDARD",
        Owner: { ID: "owner" },
      })),
    CommonPrefixes: [],
  } as COS.GetBucketResult;
}

beforeEach(async () => {
  currentTime = new Date();
  content = new Map();
  vi.spyOn(COS.prototype, "getBucketVersioning").mockResolvedValue({
    VersioningConfiguration: {},
  } as COS.GetBucketVersioningResult);
  vi.spyOn(COS.prototype, "getBucketAcl").mockResolvedValue({
    ACL: "private",
    Owner: { ID: "owner" },
    Grants: [{ Grantee: { ID: "owner" }, Permission: "FULL_CONTROL" }],
  } as COS.GetBucketAclResult);
  inspection.mockReset().mockImplementation(async (url) => {
    const stored = content.get(new URL(String(url)).pathname);
    return stored === undefined
      ? new Response(null, { status: 404 })
      : new Response(new Uint8Array(stored), {
          headers: { "x-cos-server-side-encryption": "AES256" },
        });
  });
  vi.stubGlobal("fetch", inspection);
  const storage = createDocumentStorage({
    DOCUMENT_STORAGE_PROVIDER: "tencent-cos",
    COS_BUCKET: "chronelle-test-1250000000",
    COS_REGION: "ap-guangzhou",
    COS_SECRET_ID: "test-secret-id",
    COS_SECRET_KEY: "test-secret-key",
  });
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
  app = buildApp(
    createDevelopmentAppDependencies(database.connection, {
      storage,
      clock: () => currentTime,
      documentTransferTtlMs: 60_000,
    }),
  );
  const owner = await signIn("owner@example.com");
  const viewer = await signIn("viewer@example.com");
  ownerHeaders = {
    authorization: `Bearer ${owner.accessToken}`,
    "x-workspace-id": owner.workspace.id,
  };
  viewerHeaders = {
    ...ownerHeaders,
    authorization: `Bearer ${viewer.accessToken}`,
  };
  const event = await request({
    method: "POST",
    url: "/api/events",
    payload: { displayName: "Private event" },
  });
  expect(event.statusCode).toBe(201);
  eventId = eventResponseSchema.parse(event.json()).id;
});

afterEach(async () => {
  try {
    await app?.close();
  } finally {
    await database?.close();
    database = undefined;
    app = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

describe.sequential("COS attachment API with simulated cloud transport", () => {
  it("stores a native multipart upload through the create-only COS writer", async () => {
    inspection.mockImplementation(async (url, options) => {
      const key = new URL(String(url)).pathname;
      if (options?.method === "PUT") {
        expect(options.headers).toMatchObject({
          "x-cos-acl": "private",
          "x-cos-forbid-overwrite": "true",
          "x-cos-server-side-encryption": "AES256",
        });
        content.set(key, new Uint8Array(options.body as Uint8Array));
        return new Response(null, { status: 200 });
      }
      const stored = content.get(key);
      return stored === undefined
        ? new Response(null, { status: 404 })
        : new Response(Buffer.from(stored), {
            headers: { "x-cos-server-side-encryption": "AES256" },
          });
    });
    const response = await request({
      method: "POST",
      url: "/api/documents/upload-url",
      payload: {
        parentObjectId: eventId,
        ...metadata,
        transferMode: "multipart",
      },
    });
    expect(response.statusCode).toBe(201);
    const authorization = documentUploadAuthorizationResponseSchema.parse(
      response.json(),
    );
    expect(authorization.upload.method).toBe("POST");
    expect(authorization.upload.url).toMatch(
      /^\/api\/document-transfers\/upload-file\//u,
    );
    const boundary = "native-upload-test";
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="receipt.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
      Buffer.from(bytes),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const transfer = () =>
      request(
        {
          method: "POST",
          url: authorization.upload.url,
          payload,
        },
        { "content-type": `multipart/form-data; boundary=${boundary}` },
      );
    expect((await transfer()).statusCode).toBe(204);
    expect((await transfer()).statusCode).toBe(404);
    expect(inspection).toHaveBeenCalledTimes(1);
    const created = await finalize(authorization.id);
    expect(created.statusCode).toBe(201);
    expect(
      documentAttachmentResponseSchema.parse(created.json()).document.id,
    ).toBeTruthy();
    expect(
      (
        await testDb()
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.action, "document.uploaded"))
      ).length,
    ).toBe(1);
  });

  it("finalizes one canonical document and issues inherited Viewer downloads", async () => {
    const grant = await share("viewer");
    const authorization = await authorize();
    const key = new URL(authorization.upload.url).pathname;
    content.set(key, bytes);
    const response = await finalize(authorization.id);
    expect(response.statusCode).toBe(201);
    const attachment = documentAttachmentResponseSchema.parse(response.json());
    const db = testDb();
    expect(await db.select().from(documents)).toEqual([
      expect.objectContaining({
        objectId: attachment.document.id,
        storageProvider: "tencent-cos",
        storageKey: key.slice(1),
        encryptionMode: "cos-sse-aes256",
        checksumSha256: metadata.checksumSha256,
      }),
    ]);
    expect(
      await db
        .select()
        .from(objectRevisions)
        .where(eq(objectRevisions.objectId, attachment.document.id)),
    ).toEqual([
      expect.objectContaining({ objectVersion: 1, mutationKind: "created" }),
    ]);
    const detail = await request(
      { method: "GET", url: `/api/events/${eventId}/detail` },
      viewerHeaders,
    );
    expect(
      eventDetailResponseSchema
        .parse(detail.json())
        .documents.map(({ id }) => id),
    ).toEqual([attachment.document.id]);
    const downloadPath = `/api/documents/${attachment.document.id}/download-url`;
    const download = await request(
      { method: "GET", url: downloadPath },
      viewerHeaders,
    );
    expect(download.statusCode).toBe(200);
    expect(
      new URL(
        documentDownloadAuthorizationResponseSchema.parse(download.json())
          .download.url,
      ).pathname,
    ).toBe(key);
    expect(download.body).not.toContain("test-secret-key");
    const audit = await db
      .select()
      .from(auditEvents)
      .where(like(auditEvents.action, "document.%"));
    expect(audit.map(({ action }) => action).sort()).toEqual([
      "document.created",
      "document.download_authorized",
      "document.upload_authorized",
    ]);
    const count = (await db.select().from(auditEvents)).length;
    expect((await finalize(authorization.id)).statusCode).toBe(404);
    expect((await db.select().from(auditEvents)).length).toBe(count);
    expect(
      (await request({ method: "DELETE", url: `/api/shares/${grant.id}` }))
        .statusCode,
    ).toBe(200);
    expect(
      (await request({ method: "GET", url: downloadPath }, viewerHeaders))
        .statusCode,
    ).toBe(404);
  });

  it("rejects unrelated, cross-workspace, and Viewer writes before storage access", async () => {
    const signer = vi.spyOn(COS.prototype, "getObjectUrl");
    const upload = {
      method: "POST" as const,
      url: "/api/documents/upload-url",
      payload: { parentObjectId: eventId, ...metadata },
    };
    expect((await request(upload, viewerHeaders)).statusCode).toBe(404);
    const other = await signIn("other@example.com");
    expect(
      (
        await request(upload, {
          authorization: `Bearer ${other.accessToken}`,
          "x-workspace-id": other.workspace.id,
        })
      ).statusCode,
    ).toBe(404);
    await share("viewer");
    expect((await request(upload, viewerHeaders)).statusCode).toBe(404);
    expect(signer).not.toHaveBeenCalled();
    expect(inspection).not.toHaveBeenCalled();
    expect(
      await testDb().select().from(documentTransferAuthorizations),
    ).toEqual([]);
  });

  it.each([new Uint8Array([1, 2, 3, 4]), new Uint8Array(5)])(
    "rejects mismatched stored bytes %j without canonical or ledger writes",
    async (stored) => {
      const authorization = await authorize();
      content.set(new URL(authorization.upload.url).pathname, stored);
      const db = testDb();
      const audit = await db.select().from(auditEvents);
      expect((await finalize(authorization.id)).statusCode).toBe(400);
      expect(await db.select().from(documents)).toEqual([]);
      expect(await db.select().from(auditEvents)).toEqual(audit);
      expect(await db.select().from(documentTransferAuthorizations)).toEqual([
        expect.objectContaining({ finalizedAt: null, consumedAt: null }),
      ]);
    },
  );

  it("reauthorizes after cloud inspection before finalizing", async () => {
    const grant = await share("editor");
    const authorization = await authorize(viewerHeaders);
    inspection.mockImplementationOnce(async () => {
      expect(
        (await request({ method: "DELETE", url: `/api/shares/${grant.id}` }))
          .statusCode,
      ).toBe(200);
      return new Response(bytes, {
        headers: { "x-cos-server-side-encryption": "AES256" },
      });
    });
    expect((await finalize(authorization.id, viewerHeaders)).statusCode).toBe(
      404,
    );
    expect(await testDb().select().from(documents)).toEqual([]);
    expect(
      await testDb()
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "document.created")),
    ).toEqual([]);
  });

  it("rejects expired or missing uploads without creating a document", async () => {
    const authorization = await authorize();
    expect((await finalize(authorization.id)).statusCode).toBe(404);
    content.set(new URL(authorization.upload.url).pathname, bytes);
    currentTime = new Date(currentTime.getTime() + 60_001);
    inspection.mockClear();
    expect((await finalize(authorization.id)).statusCode).toBe(404);
    expect(inspection).not.toHaveBeenCalled();
    expect(await testDb().select().from(documents)).toEqual([]);
  });
});

describe.sequential("COS inventory API with simulated cloud transport", () => {
  const inventory = {
    method: "GET" as const,
    url: "/api/workspace/storage-inventory",
  };

  it("retains trashed documents and pending uploads without reading bytes or exposing keys", async () => {
    const authorization = await authorize();
    const key = new URL(authorization.upload.url).pathname;
    content.set(key, bytes);
    const attachment = documentAttachmentResponseSchema.parse(
      (await finalize(authorization.id)).json(),
    );
    expect(
      (
        await request({
          method: "DELETE",
          url: `/api/objects/${attachment.document.id}?expectedVersion=1`,
        })
      ).statusCode,
    ).toBe(200);
    const pending = await authorize();
    content.set(new URL(pending.upload.url).pathname, bytes);
    const prefix = `workspaces/${ownerHeaders["x-workspace-id"]}/documents/`;
    content.set(`/${prefix}${createId()}`, bytes);
    content.set(`/workspaces/${createId()}/documents/${createId()}`, bytes);
    const list = vi
      .spyOn(COS.prototype, "getBucket")
      .mockImplementation(listStoredKeys);
    const signer = vi.spyOn(COS.prototype, "getObjectUrl");
    inspection.mockClear();
    const snapshot = async () => ({
      documents: await testDb()
        .select()
        .from(documents)
        .orderBy(documents.objectId),
      revisions: await testDb()
        .select()
        .from(objectRevisions)
        .orderBy(objectRevisions.id),
      audits: await testDb().select().from(auditEvents).orderBy(auditEvents.id),
      content: [...content.entries()],
    });
    const before = await snapshot();

    const response = await request(inventory);

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(storageInventoryResponseSchema.parse(response.json())).toMatchObject(
      {
        storageProvider: "tencent-cos",
        consistency: "observational",
        retentionPolicy: "retain-all",
        references: { canonical: 1, missingCanonical: 0 },
        entries: {
          canonical: 1,
          pendingUpload: 1,
          unreferenced: 1,
          unsupported: 0,
        },
      },
    );
    expect(list).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ Prefix: prefix }),
    );
    expect(await snapshot()).toEqual(before);
    expect(inspection).not.toHaveBeenCalled();
    expect(signer).not.toHaveBeenCalled();
    for (const secret of [
      key.slice(1),
      attachment.document.id,
      metadata.originalFilename,
      "test-secret",
    ])
      expect(response.body).not.toContain(secret);
  });

  it("denies unrelated users and shared Viewers before cloud listing", async () => {
    const list = vi
      .spyOn(COS.prototype, "getBucket")
      .mockImplementation(listStoredKeys);
    expect((await request(inventory, viewerHeaders)).statusCode).toBe(404);
    await share("viewer");
    expect((await request(inventory, viewerHeaders)).statusCode).toBe(404);
    const other = await signIn("other@example.com");
    expect(
      (
        await request(inventory, {
          ...ownerHeaders,
          authorization: `Bearer ${other.accessToken}`,
        })
      ).statusCode,
    ).toBe(404);
    expect(list).not.toHaveBeenCalled();
  });

  it("suppresses the report when workspace ownership is revoked during cloud I/O", async () => {
    vi.spyOn(COS.prototype, "getBucket").mockImplementationOnce(
      async (parameters) => {
        await testDb()
          .update(workspaceMembers)
          .set({ role: "viewer" })
          .where(
            eq(
              workspaceMembers.workspaceId,
              ownerHeaders["x-workspace-id"] ?? "",
            ),
          );
        return listStoredKeys(parameters);
      },
    );
    const response = await request(inventory);
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("entries");
  });

  it("discards partial counts when a later cloud page fails", async () => {
    const prefix = `workspaces/${ownerHeaders["x-workspace-id"]}/documents/`;
    const key = `${prefix}${createId()}`;
    content.set(`/${key}`, bytes);
    const list = vi
      .spyOn(COS.prototype, "getBucket")
      .mockImplementationOnce(async (parameters) => ({
        ...(await listStoredKeys(parameters)),
        IsTruncated: "true",
        NextMarker: encodeURIComponent(key),
      }))
      .mockRejectedValueOnce(new Error("private cloud credential or path"));
    const response = await request(inventory);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: { code: "inventory_unavailable" },
    });
    expect(list).toHaveBeenCalledTimes(2);
    for (const secret of ["entries", key, "credential", "private cloud"])
      expect(response.body).not.toContain(secret);
  });
});
