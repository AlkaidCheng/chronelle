import type { UserPrincipal } from "@livtales/authorization";
import type {
  CloudBaseRdbReader,
  DocumentTransferAuthorizationRow,
  DocumentTransferOperation as TransferOperation,
} from "@livtales/db";

import { cloudbaseInteger } from "./cloudbase-object-read-support.js";
import {
  cloudbaseBigInt,
  cloudbaseDate,
  cloudbaseFilters,
  cloudbaseNullableDate,
  cloudbaseText,
} from "./cloudbase-read-support.js";
import type {
  AttachmentRelation,
  DocumentTransferOperation,
  DocumentTransferReadRepository,
} from "./document-transfers.js";

const transferColumns =
  "id,workspace_id,operation,token_hash,resource_id,storage_provider,storage_key,original_filename,mime_type,size_bytes::text,checksum_sha256,authorized_by,created_at,expires_at,consumed_at,finalized_at";

type TransferRow = Record<string, unknown>;

function cloudbaseTransfer(row: TransferRow): DocumentTransferAuthorizationRow {
  const operation = cloudbaseText(row.operation, "transfer operation");
  if (operation !== "upload" && operation !== "download")
    throw new Error("CloudBase returned an invalid transfer operation.");
  return {
    id: cloudbaseText(row.id, "transfer id"),
    workspaceId: cloudbaseText(row.workspace_id, "transfer workspace"),
    operation: operation as TransferOperation,
    tokenHash: cloudbaseText(row.token_hash, "token hash"),
    resourceId: cloudbaseText(row.resource_id, "transfer resource"),
    storageProvider: cloudbaseText(row.storage_provider, "storage provider"),
    storageKey: cloudbaseText(row.storage_key, "storage key"),
    originalFilename: cloudbaseText(row.original_filename, "filename"),
    mimeType: cloudbaseText(row.mime_type, "mime type"),
    sizeBytes: cloudbaseBigInt(row.size_bytes, "size_bytes"),
    checksumSha256: cloudbaseText(row.checksum_sha256, "checksum"),
    authorizedBy: cloudbaseText(row.authorized_by, "authorizer"),
    createdAt: cloudbaseDate(row.created_at, "created_at"),
    expiresAt: cloudbaseDate(row.expires_at, "expires_at"),
    consumedAt: cloudbaseNullableDate(row.consumed_at, "consumed_at"),
    finalizedAt: cloudbaseNullableDate(row.finalized_at, "finalized_at"),
  };
}

/**
 * Document transfer reads through the gateway's table route. The transport
 * has no range filter, so expiry is applied here after the read; a credential
 * hash is unique, so each lookup reads at most one row.
 */
export class CloudBaseDocumentTransferReadRepository implements DocumentTransferReadRepository {
  readonly #client: CloudBaseRdbReader;

  constructor(client: CloudBaseRdbReader) {
    this.#client = client;
  }

  async findByCredential(
    tokenHash: string,
    operation: DocumentTransferOperation,
    now: Date,
  ): Promise<DocumentTransferAuthorizationRow | null> {
    const [row] = await this.#client.select<TransferRow>(
      "document_transfer_authorizations",
      {
        columns: transferColumns,
        filters: cloudbaseFilters(
          ["token_hash", "eq", tokenHash],
          ["operation", "eq", operation],
          ["consumed_at", "is", null],
        ),
        limit: 1,
      },
    );
    if (row === undefined) return null;
    const transfer = cloudbaseTransfer(row);
    return transfer.expiresAt > now ? transfer : null;
  }

  async findUploadForFinalization(
    principal: UserPrincipal,
    transferId: string,
    now: Date,
  ): Promise<DocumentTransferAuthorizationRow | null> {
    const [row] = await this.#client.select<TransferRow>(
      "document_transfer_authorizations",
      {
        columns: transferColumns,
        filters: cloudbaseFilters(
          ["id", "eq", transferId],
          ["workspace_id", "eq", principal.workspaceId],
          ["authorized_by", "eq", principal.userId],
          ["operation", "eq", "upload"],
          ["finalized_at", "is", null],
        ),
        limit: 1,
      },
    );
    if (row === undefined) return null;
    const transfer = cloudbaseTransfer(row);
    if (transfer.consumedAt === null && transfer.expiresAt <= now) return null;
    return transfer;
  }

  async listAttachmentRelations(
    principal: UserPrincipal,
    parentObjectId: string,
  ): Promise<AttachmentRelation[]> {
    const relations = await this.#client.select<Record<string, unknown>>(
      "object_relations",
      {
        columns: "id,source_object_id,version",
        filters: cloudbaseFilters(
          ["workspace_id", "eq", principal.workspaceId],
          ["relation_type", "eq", "attached_to"],
          ["target_object_id", "eq", parentObjectId],
          ["deleted_at", "is", null],
        ),
      },
    );
    if (relations.length === 0) return [];
    const sources = await this.#client.select<Record<string, unknown>>(
      "objects",
      {
        columns: "id",
        filters: cloudbaseFilters(
          ["workspace_id", "eq", principal.workspaceId],
          ["object_type", "eq", "document"],
          ["deleted_at", "is", null],
          [
            "id",
            "in",
            relations.map((relation) =>
              cloudbaseText(relation.source_object_id, "relation source"),
            ),
          ],
        ),
      },
    );
    const liveDocuments = new Set(
      sources.map((source) => cloudbaseText(source.id, "document id")),
    );
    return relations.flatMap((relation) => {
      const documentId = cloudbaseText(
        relation.source_object_id,
        "relation source",
      );
      return liveDocuments.has(documentId)
        ? [
            {
              documentId,
              relationId: cloudbaseText(relation.id, "relation id"),
              relationVersion: cloudbaseInteger(
                relation.version,
                "relation version",
              ),
            },
          ]
        : [];
    });
  }
}
