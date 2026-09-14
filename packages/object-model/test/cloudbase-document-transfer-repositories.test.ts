import { AuthorizationDeniedError } from "@chronelle/authorization";
import {
  CloudBaseRpcError,
  type CloudBaseRdbClient,
  type CloudBaseRdbQuery,
} from "@chronelle/db";
import { describe, expect, it, vi } from "vitest";

import { CloudBaseDocumentTransferReadRepository } from "../src/cloudbase-document-transfer-read-repository.js";
import { CloudBaseDocumentTransferWriteRepository } from "../src/cloudbase-document-transfer-write-repository.js";
import { DocumentTransferUnavailableError } from "../src/errors.js";

const workspaceId = "00000000-0000-7000-8000-000000000001";
const eventId = "00000000-0000-7000-8000-000000000002";
const documentId = "00000000-0000-7000-8000-000000000003";
const relationId = "00000000-0000-7000-8000-000000000004";
const userId = "00000000-0000-7000-8000-000000000005";
const transferId = "00000000-0000-7000-8000-000000000010";
const principal = { type: "user" as const, userId, workspaceId };
const context = { principal, requestId: "request-1" };
const createdAt = new Date("2030-08-01T12:00:00.000Z");
const expiresAt = new Date("2030-08-01T12:05:00.000Z");

const transferRow = {
  id: transferId,
  workspace_id: workspaceId,
  operation: "upload",
  token_hash: "a".repeat(64),
  resource_id: eventId,
  storage_provider: "local-filesystem",
  storage_key: `workspaces/${workspaceId}/documents/${transferId}`,
  original_filename: "agenda.txt",
  mime_type: "text/plain",
  size_bytes: "9007199254740993",
  checksum_sha256: "b".repeat(64),
  authorized_by: userId,
  created_at: createdAt.toISOString(),
  expires_at: expiresAt.toISOString(),
  consumed_at: null,
  finalized_at: null,
};

const transfer = {
  id: transferId,
  workspaceId,
  operation: "upload" as const,
  tokenHash: "a".repeat(64),
  resourceId: eventId,
  storageProvider: "local-filesystem",
  storageKey: `workspaces/${workspaceId}/documents/${transferId}`,
  originalFilename: "agenda.txt",
  mimeType: "text/plain",
  sizeBytes: 9_007_199_254_740_993n,
  checksumSha256: "b".repeat(64),
  authorizedBy: userId,
  createdAt,
  expiresAt,
  consumedAt: null,
  finalizedAt: null,
};

const documentRows = {
  object: {
    id: documentId,
    workspace_id: workspaceId,
    object_type: "document",
    display_name: "agenda.txt",
    created_by: userId,
    permission_scope_id: eventId,
    custom_properties: {},
    metadata: {},
    created_at: createdAt.toISOString(),
    updated_at: createdAt.toISOString(),
    archived_at: null,
    deleted_at: null,
    version: 1,
  },
  document: {
    object_id: documentId,
    workspace_id: workspaceId,
    storage_provider: "local-filesystem",
    storage_key: transfer.storageKey,
    original_filename: "agenda.txt",
    mime_type: "text/plain",
    size_bytes: "9007199254740993",
    checksum_sha256: "b".repeat(64),
    encryption_mode: "filesystem-permissions",
  },
};

function reader(rows: Record<string, Record<string, unknown>[]>) {
  const select = vi.fn(async (table: string, query?: CloudBaseRdbQuery) => {
    const tableRows = rows[table] ?? [];
    return tableRows.filter((row) =>
      (query?.filters ?? []).every((filter) =>
        filter.operator === "is"
          ? row[filter.column] === filter.value
          : filter.operator === "in"
            ? (filter.value as unknown[]).includes(row[filter.column])
            : row[filter.column] === filter.value,
      ),
    );
  }) as unknown as CloudBaseRdbClient["select"];
  return {
    capabilities: {
      transactions: false as const,
      nativeTcp: false as const,
      serverFunctions: true,
    },
    select,
  };
}

describe("CloudBaseDocumentTransferWriteRepository", () => {
  it("calls the three functions with encoded arguments and decodes the attachment", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        document: documentRows,
        relationId,
        relationVersion: 1,
      });
    const repository = new CloudBaseDocumentTransferWriteRepository({ rpc });
    const {
      workspaceId: _,
      authorizedBy: __,
      consumedAt,
      finalizedAt,
      ...record
    } = transfer;
    await repository.authorize(context, record);
    await repository.consume(transfer, createdAt, "request-2");
    const attachment = await repository.finalize(
      context,
      transfer,
      documentId,
      relationId,
      createdAt,
      "filesystem-permissions",
    );

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "chronelle_document_transfer_authorize",
      {
        workspace_id: workspaceId,
        user_id: userId,
        request_id: "request-1",
        transfer: {
          ...record,
          sizeBytes: "9007199254740993",
          createdAt: createdAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      },
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "chronelle_document_transfer_consume",
      {
        transfer_id: transferId,
        operation: "upload",
        consumed_at: createdAt.toISOString(),
        request_id: "request-2",
      },
    );
    expect(rpc).toHaveBeenNthCalledWith(3, "chronelle_document_finalize", {
      workspace_id: workspaceId,
      user_id: userId,
      request_id: "request-1",
      transfer_id: transferId,
      document_id: documentId,
      relation_id: relationId,
      finalized_at: createdAt.toISOString(),
      encryption_mode: "filesystem-permissions",
    });
    expect(attachment).toMatchObject({
      relationId,
      relationVersion: 1,
      document: {
        id: documentId,
        objectType: "document",
        sizeBytes: 9_007_199_254_740_993n,
        encryptionMode: "filesystem-permissions",
      },
    });
    expect(consumedAt).toBeNull();
    expect(finalizedAt).toBeNull();
  });

  it("maps PT404 to the transfer error and PT403 to the denial", async () => {
    const unavailable = new CloudBaseDocumentTransferWriteRepository({
      rpc: vi
        .fn()
        .mockRejectedValue(
          new CloudBaseRpcError(
            404,
            "DATABASE_PT404",
            "The document transfer is unavailable.",
          ),
        ),
    });
    await expect(
      unavailable.consume(transfer, createdAt, "request-2"),
    ).rejects.toBeInstanceOf(DocumentTransferUnavailableError);
    const denied = new CloudBaseDocumentTransferWriteRepository({
      rpc: vi
        .fn()
        .mockRejectedValue(
          new CloudBaseRpcError(
            403,
            "DATABASE_PT403",
            "The resource is unavailable.",
          ),
        ),
    });
    await expect(
      denied.finalize(
        context,
        transfer,
        documentId,
        relationId,
        createdAt,
        "filesystem-permissions",
      ),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });
});

describe("CloudBaseDocumentTransferReadRepository", () => {
  it("finds a live transfer by credential and applies expiry after the read", async () => {
    const repository = new CloudBaseDocumentTransferReadRepository(
      reader({ document_transfer_authorizations: [transferRow] }),
    );
    await expect(
      repository.findByCredential("a".repeat(64), "upload", createdAt),
    ).resolves.toEqual(transfer);
    await expect(
      repository.findByCredential("a".repeat(64), "upload", expiresAt),
    ).resolves.toBeNull();
    await expect(
      repository.findByCredential("a".repeat(64), "download", createdAt),
    ).resolves.toBeNull();
  });

  it("finds the caller's upload for finalization unless it expired unconsumed", async () => {
    const repository = new CloudBaseDocumentTransferReadRepository(
      reader({ document_transfer_authorizations: [transferRow] }),
    );
    await expect(
      repository.findUploadForFinalization(principal, transferId, createdAt),
    ).resolves.toEqual(transfer);
    await expect(
      repository.findUploadForFinalization(principal, transferId, expiresAt),
    ).resolves.toBeNull();
    await expect(
      repository.findUploadForFinalization(
        { ...principal, userId: eventId },
        transferId,
        createdAt,
      ),
    ).resolves.toBeNull();
    const consumed = new CloudBaseDocumentTransferReadRepository(
      reader({
        document_transfer_authorizations: [
          { ...transferRow, consumed_at: createdAt.toISOString() },
        ],
      }),
    );
    await expect(
      consumed.findUploadForFinalization(principal, transferId, expiresAt),
    ).resolves.toMatchObject({ consumedAt: createdAt });
  });

  it("lists attachment relations whose source is a live Document", async () => {
    const repository = new CloudBaseDocumentTransferReadRepository(
      reader({
        object_relations: [
          {
            id: relationId,
            workspace_id: workspaceId,
            relation_type: "attached_to",
            target_object_id: eventId,
            source_object_id: documentId,
            version: 2,
            deleted_at: null,
          },
          {
            id: "00000000-0000-7000-8000-000000000006",
            workspace_id: workspaceId,
            relation_type: "attached_to",
            target_object_id: eventId,
            source_object_id: "00000000-0000-7000-8000-000000000007",
            version: 1,
            deleted_at: null,
          },
        ],
        objects: [
          {
            id: documentId,
            workspace_id: workspaceId,
            object_type: "document",
            deleted_at: null,
          },
          {
            id: "00000000-0000-7000-8000-000000000007",
            workspace_id: workspaceId,
            object_type: "document",
            deleted_at: createdAt.toISOString(),
          },
        ],
      }),
    );
    await expect(
      repository.listAttachmentRelations(principal, eventId),
    ).resolves.toEqual([{ documentId, relationId, relationVersion: 2 }]);
  });
});
