import { CloudBaseRpcError, type CloudBaseRdbClient } from "@chronelle/db";
import type { DocumentTransferAuthorizationRow } from "@chronelle/db";

import { cloudbaseResourceFromRows } from "./cloudbase-read-support.js";
import { mapRpcError } from "./cloudbase-rpc-errors.js";
import type {
  DocumentTransferAuthorization,
  DocumentTransferWriteRepository,
} from "./document-transfers.js";
import { DocumentTransferUnavailableError } from "./errors.js";
import type { DocumentAttachmentResource, MutationContext } from "./types.js";

const unavailable = () => new DocumentTransferUnavailableError();

/**
 * Document transfers through chronelle_document_transfer_authorize,
 * chronelle_document_transfer_consume, and chronelle_document_finalize:
 * each call is one transaction that applies the service's authorization and
 * transfer-state rules and writes the audit event; the storage provider is
 * still the service's concern.
 */
export class CloudBaseDocumentTransferWriteRepository implements DocumentTransferWriteRepository {
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;

  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    this.#client = client;
  }

  async authorize(
    context: MutationContext,
    transfer: DocumentTransferAuthorization,
  ): Promise<void> {
    await this.#call("chronelle_document_transfer_authorize", {
      workspace_id: context.principal.workspaceId,
      user_id: context.principal.userId,
      request_id: context.requestId,
      transfer: {
        ...transfer,
        sizeBytes: transfer.sizeBytes.toString(),
        createdAt: transfer.createdAt.toISOString(),
        expiresAt: transfer.expiresAt.toISOString(),
      },
    });
  }

  async consume(
    transfer: DocumentTransferAuthorizationRow,
    consumedAt: Date,
    requestId: string,
  ): Promise<void> {
    await this.#call("chronelle_document_transfer_consume", {
      transfer_id: transfer.id,
      operation: transfer.operation,
      consumed_at: consumedAt.toISOString(),
      request_id: requestId,
    });
  }

  async finalize(
    context: MutationContext,
    transfer: DocumentTransferAuthorizationRow,
    documentId: string,
    relationId: string,
    finalizedAt: Date,
    encryptionMode: string,
  ): Promise<DocumentAttachmentResource> {
    const result = await this.#call("chronelle_document_finalize", {
      workspace_id: context.principal.workspaceId,
      user_id: context.principal.userId,
      request_id: context.requestId,
      transfer_id: transfer.id,
      document_id: documentId,
      relation_id: relationId,
      finalized_at: finalizedAt.toISOString(),
      encryption_mode: encryptionMode,
    });
    if (result === null || typeof result !== "object")
      throw new Error("CloudBase returned an invalid attachment.");
    const record = result as Record<string, unknown>;
    const document = cloudbaseResourceFromRows(record.document);
    if (document.objectType !== "document")
      throw new Error("CloudBase returned an invalid attachment.");
    if (typeof record.relationId !== "string" || record.relationVersion !== 1)
      throw new Error("CloudBase returned an invalid attachment.");
    return { document, relationId: record.relationId, relationVersion: 1 };
  }

  async #call(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await this.#client.rpc(functionName, args);
    } catch (error) {
      if (error instanceof CloudBaseRpcError)
        throw mapRpcError(error, { notFound: unavailable });
      throw error;
    }
  }
}
