import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuthorizationDeniedError } from "@chronelle/authorization";
import {
  auditEvents,
  createId,
  documentTransferAuthorizations,
  objectRelations,
} from "@chronelle/db";
import { LocalFilesystemStorageProvider } from "@chronelle/storage";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseDocumentTransferReadRepository } from "../src/cloudbase-document-transfer-read-repository.js";
import { CloudBaseDocumentTransferWriteRepository } from "../src/cloudbase-document-transfer-write-repository.js";
import { CloudBaseObjectReadRepository } from "../src/cloudbase-object-read-repository.js";
import { DocumentService } from "../src/document-service.js";
import {
  DocumentTransferUnavailableError,
  InvalidDocumentUploadError,
} from "../src/errors.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import type { DocumentResource } from "../src/types.js";
import { liveReader } from "./cloudbase-read-double.js";
import {
  createWriteHarness,
  failure,
  ledger,
  mutationContext,
  shape,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// chronelle_document_transfer_authorize, chronelle_document_transfer_consume,
// and chronelle_document_finalize must leave what DocumentService leaves
// around the storage provider: the transfer rows with their consumption and
// finalization, the Document with its relation, audit event, and revision,
// and the five transfer audits; and they must refuse the same requests with
// the same errors. Both backends store bytes with one local provider.

let harness: WriteHarness;
let root: string;
let storage: LocalFilesystemStorageProvider;
let objects: EventPlanningObjectService;
let reference: DocumentService;
let cloudbase: DocumentService;

const clock = () => new Date("2030-08-01T12:00:00.000Z");
const bytes = Buffer.from("attachment bytes");
const checksum = createHash("sha256").update(bytes).digest("hex");
const token = (url: string) => decodeURIComponent(url.split("/").at(-1) ?? "");

beforeAll(async () => {
  harness = await createWriteHarness("Document transfers");
  root = await mkdtemp(join(tmpdir(), "chronelle-transfers-"));
  storage = new LocalFilesystemStorageProvider({ root });
  const db = harness.database.connection.db;
  objects = new EventPlanningObjectService(db, clock);
  reference = new DocumentService(db, objects, storage, { clock });
  const reader = liveReader(db);
  cloudbase = new DocumentService(
    db,
    new EventPlanningObjectService(db, clock, {
      objects: new CloudBaseObjectReadRepository(reader, clock),
    }),
    storage,
    {
      clock,
      writes: new CloudBaseDocumentTransferWriteRepository(harness),
      reads: new CloudBaseDocumentTransferReadRepository(reader),
    },
  );
});

afterAll(async () => {
  await harness?.database.close();
  await rm(root, { recursive: true, force: true });
});

const context = (userId?: string) => mutationContext(harness, userId);

const backends = () =>
  [
    ["postgres", reference],
    ["cloudbase", cloudbase],
  ] as const;

/** A Document resource without its per-run key, plus whether the key is workspace-scoped. */
function documentShape(document: DocumentResource) {
  const { storageKey, ...rest } = document;
  return {
    ...shape(rest),
    keyIsWorkspaceScoped: storageKey.startsWith(
      `workspaces/${harness.workspaceId}/documents/`,
    ),
  };
}

/** The document's ledger with per-run identifiers reduced to presence flags. */
async function documentLedger(documentId: string) {
  return (await ledger(harness, documentId)).map((entry) => {
    const { storageKey, ...snapshot } = entry.snapshot;
    const { parentObjectId, relationId, transferAuthorizationId, ...metadata } =
      entry.metadata;
    return {
      ...entry,
      snapshot: { ...snapshot, keyPresent: typeof storageKey === "string" },
      metadata: {
        ...metadata,
        parentPresent: typeof parentObjectId === "string",
        relationPresent: typeof relationId === "string",
        transferPresent: typeof transferAuthorizationId === "string",
      },
    };
  });
}

/** The transfer rows of a workspace resource, without identifiers, credentials, and keys. */
async function transfers(resourceIds: string[]) {
  const rows = await harness.database.connection.db
    .select()
    .from(documentTransferAuthorizations)
    .where(
      and(
        eq(documentTransferAuthorizations.workspaceId, harness.workspaceId),
        inArray(documentTransferAuthorizations.resourceId, resourceIds),
      ),
    )
    .orderBy(documentTransferAuthorizations.operation);
  return rows.map((row) => ({
    operation: row.operation,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    checksumSha256: row.checksumSha256,
    storageProvider: row.storageProvider,
    keyIsWorkspaceScoped: row.storageKey.startsWith(
      `workspaces/${harness.workspaceId}/documents/`,
    ),
    authorizedByOwner: row.authorizedBy === harness.ownerId,
    consumedAt: row.consumedAt,
    finalizedAt: row.finalizedAt,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  }));
}

async function transferAudits(resourceIds: string[]) {
  const rows = await harness.database.connection.db
    .select({ action: auditEvents.action, metadata: auditEvents.metadata })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.workspaceId, harness.workspaceId),
        inArray(auditEvents.resourceId, resourceIds),
      ),
    );
  return rows
    .map((row) => ({
      action: row.action,
      transferRecorded:
        typeof (row.metadata as { transferAuthorizationId?: unknown })
          .transferAuthorizationId === "string",
    }))
    .sort((a, b) => a.action.localeCompare(b.action));
}

describe.sequential("CloudBase document transfers", () => {
  it("uploads, finalizes, lists, and downloads with the same rows and audits", async () => {
    const results = [];
    for (const [, service] of backends()) {
      const event = await objects.createEvent(context(), {
        displayName: "Kickoff",
      });
      const authorized = await service.authorizeUpload(context(), {
        parentObjectId: event.id,
        originalFilename: "agenda.txt",
        mimeType: "text/plain",
        sizeBytes: bytes.length,
        checksumSha256: checksum,
      });
      await service.receiveUpload(
        token(authorized.upload.url),
        bytes,
        createId(),
      );
      const attachment = await service.finalizeUpload(context(), authorized.id);
      const listed = await service.listAttachments(
        context().principal,
        event.id,
      );
      const download = await service.authorizeDownload(
        context(),
        attachment.document.id,
      );
      const downloaded = await service.consumeDownload(
        token(download.download.url),
        createId(),
      );
      const [relation] = await harness.database.connection.db
        .select({
          version: objectRelations.version,
          relationType: objectRelations.relationType,
          target: objectRelations.targetObjectId,
          source: objectRelations.sourceObjectId,
          deletedAt: objectRelations.deletedAt,
        })
        .from(objectRelations)
        .where(eq(objectRelations.id, attachment.relationId));
      results.push({
        attachment: {
          document: documentShape(attachment.document),
          relationVersion: attachment.relationVersion,
        },
        relation: relation && {
          ...relation,
          target: relation.target === event.id,
          source: relation.source === attachment.document.id,
        },
        listed: {
          items: listed.items.map((item) => ({
            document: documentShape(item.document),
            relationVersion: item.relationVersion,
            relationMatches: item.relationId === attachment.relationId,
          })),
          lockedAttachmentCount: listed.lockedAttachmentCount,
        },
        downloaded: {
          bytes: Buffer.from(downloaded.bytes).toString("utf8"),
          mimeType: downloaded.mimeType,
          originalFilename: downloaded.originalFilename,
        },
        transfers: await transfers([event.id, attachment.document.id]),
        ledger: await documentLedger(attachment.document.id),
        audits: await transferAudits([event.id, attachment.document.id]),
      });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]?.attachment).toMatchObject({
      document: {
        objectType: "document",
        displayName: "agenda.txt",
        originalFilename: "agenda.txt",
        mimeType: "text/plain",
        sizeBytes: BigInt(bytes.length),
        checksumSha256: checksum,
        storageProvider: "local-filesystem",
        encryptionMode: "filesystem-permissions",
        version: 1,
        ownsScope: false,
      },
      relationVersion: 1,
    });
    expect(results[0]?.relation).toEqual({
      version: 1,
      relationType: "attached_to",
      target: true,
      source: true,
      deletedAt: null,
    });
    expect(results[0]?.listed).toMatchObject({
      items: [{ relationVersion: 1, relationMatches: true }],
      lockedAttachmentCount: 0,
    });
    expect(results[0]?.downloaded).toEqual({
      bytes: "attachment bytes",
      mimeType: "text/plain",
      originalFilename: "agenda.txt",
    });
    expect(results[0]?.transfers).toEqual([
      {
        operation: "download",
        originalFilename: "agenda.txt",
        mimeType: "text/plain",
        sizeBytes: BigInt(bytes.length),
        checksumSha256: checksum,
        storageProvider: "local-filesystem",
        keyIsWorkspaceScoped: true,
        authorizedByOwner: true,
        consumedAt: clock(),
        finalizedAt: null,
        createdAt: clock(),
        expiresAt: new Date(clock().getTime() + 5 * 60_000),
      },
      {
        operation: "upload",
        originalFilename: "agenda.txt",
        mimeType: "text/plain",
        sizeBytes: BigInt(bytes.length),
        checksumSha256: checksum,
        storageProvider: "local-filesystem",
        keyIsWorkspaceScoped: true,
        authorizedByOwner: true,
        consumedAt: clock(),
        finalizedAt: clock(),
        createdAt: clock(),
        expiresAt: new Date(clock().getTime() + 5 * 60_000),
      },
    ]);
    expect(
      results[0]?.ledger.map((entry) => [
        entry.action,
        entry.mutationKind,
        entry.metadata,
      ]),
    ).toEqual([
      [
        "document.created",
        "created",
        {
          version: 1,
          parentPresent: true,
          relationPresent: true,
          transferPresent: true,
        },
      ],
    ]);
    expect(results[0]?.audits).toEqual([
      { action: "document.created", transferRecorded: true },
      { action: "document.download_authorized", transferRecorded: true },
      { action: "document.downloaded", transferRecorded: true },
      { action: "document.upload_authorized", transferRecorded: true },
      { action: "document.uploaded", transferRecorded: true },
      { action: "event.created", transferRecorded: false },
    ]);
  });

  it("refuses the same transfers with the same errors", async () => {
    const outcomes = [];
    for (const [, service] of backends()) {
      const event = await objects.createEvent(context(), {
        displayName: "Guarded",
      });
      const reminder = await objects.createReminder(context(), {
        displayName: "Not a parent",
        remindAt: new Date("2030-09-01T09:00:00.000Z"),
      });
      const seen: string[] = [];
      const record = (error: Error) =>
        seen.push(`${error.constructor.name}: ${error.message}`);
      const refuse = async (run: () => Promise<unknown>) =>
        record(await failure(run));
      const request = {
        originalFilename: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: bytes.length,
        checksumSha256: checksum,
      };

      await refuse(() =>
        service.authorizeUpload(context(harness.viewerId), {
          ...request,
          parentObjectId: event.id,
        }),
      );
      await refuse(() =>
        service.authorizeUpload(context(), {
          ...request,
          parentObjectId: reminder.id,
        }),
      );
      await refuse(() =>
        service.authorizeUpload(context(), {
          ...request,
          parentObjectId: createId(),
        }),
      );
      const authorized = await service.authorizeUpload(context(), {
        ...request,
        parentObjectId: event.id,
      });
      await refuse(() =>
        service.receiveUpload(
          token(authorized.upload.url),
          Buffer.from("other bytes"),
          createId(),
        ),
      );
      await refuse(() => service.finalizeUpload(context(), createId()));
      await service.receiveUpload(
        token(authorized.upload.url),
        bytes,
        createId(),
      );
      await refuse(() =>
        service.receiveUpload(token(authorized.upload.url), bytes, createId()),
      );
      await refuse(() =>
        service.finalizeUpload(context(harness.viewerId), authorized.id),
      );
      const attachment = await service.finalizeUpload(context(), authorized.id);
      await refuse(() => service.finalizeUpload(context(), authorized.id));
      await refuse(() =>
        service.authorizeDownload(
          context(harness.viewerId),
          attachment.document.id,
        ),
      );
      const download = await service.authorizeDownload(
        context(),
        attachment.document.id,
      );
      await service.consumeDownload(token(download.download.url), createId());
      await refuse(() =>
        service.consumeDownload(token(download.download.url), createId()),
      );
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    const denied = `${AuthorizationDeniedError.name}: ${new AuthorizationDeniedError().message}`;
    const unavailable = `${DocumentTransferUnavailableError.name}: ${new DocumentTransferUnavailableError().message}`;
    expect(outcomes[0]).toEqual([
      denied,
      denied,
      denied,
      `${InvalidDocumentUploadError.name}: The uploaded bytes do not match the authorized size and checksum.`,
      unavailable,
      unavailable,
      unavailable,
      unavailable,
      denied,
      unavailable,
    ]);
  });
});
