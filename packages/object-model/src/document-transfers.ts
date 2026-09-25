import type { UserPrincipal } from "@livtales/authorization";
import {
  documentTransferAuthorizations,
  objectRelations,
  objects,
  type Database,
  type DocumentTransferAuthorizationRow,
} from "@livtales/db";
import { and, eq, gt, isNull } from "drizzle-orm";

import type { DocumentAttachmentResource, MutationContext } from "./types.js";

export type DocumentTransferOperation = "upload" | "download";

/** A transfer authorization as the service records it, before its row exists. */
export interface DocumentTransferAuthorization {
  readonly id: string;
  readonly operation: DocumentTransferOperation;
  readonly tokenHash: string;
  readonly resourceId: string;
  readonly storageProvider: string;
  readonly storageKey: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: bigint;
  readonly checksumSha256: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/** One `attached_to` relation of a parent whose source is a live Document. */
export interface AttachmentRelation {
  readonly documentId: string;
  readonly relationId: string;
  readonly relationVersion: number;
}

/**
 * Document transfer writes: the authorization row after the edit (upload)
 * or view (download) check on its resource, a single consumption before
 * expiry, and the finalization of an upload into a Document attached to its
 * parent, each with its audit event. The storage provider is the service's
 * concern; implementations own the rows and the transaction.
 */
export interface DocumentTransferWriteRepository {
  authorize(
    context: MutationContext,
    transfer: DocumentTransferAuthorization,
  ): Promise<void>;
  consume(
    transfer: DocumentTransferAuthorizationRow,
    consumedAt: Date,
    requestId: string,
  ): Promise<void>;
  finalize(
    context: MutationContext,
    transfer: DocumentTransferAuthorizationRow,
    documentId: string,
    relationId: string,
    finalizedAt: Date,
    encryptionMode: string,
  ): Promise<DocumentAttachmentResource>;
}

/**
 * Document transfer reads: a live transfer by its credential hash, the
 * caller's upload awaiting finalization, and the attachment relations of a
 * parent. Implementations return null for a transfer that is missing,
 * consumed, expired, or (for finalization) not the caller's.
 */
export interface DocumentTransferReadRepository {
  findByCredential(
    tokenHash: string,
    operation: DocumentTransferOperation,
    now: Date,
  ): Promise<DocumentTransferAuthorizationRow | null>;
  findUploadForFinalization(
    principal: UserPrincipal,
    transferId: string,
    now: Date,
  ): Promise<DocumentTransferAuthorizationRow | null>;
  listAttachmentRelations(
    principal: UserPrincipal,
    parentObjectId: string,
  ): Promise<AttachmentRelation[]>;
}

export class PostgresDocumentTransferReadRepository implements DocumentTransferReadRepository {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async findByCredential(
    tokenHash: string,
    operation: DocumentTransferOperation,
    now: Date,
  ): Promise<DocumentTransferAuthorizationRow | null> {
    const [authorization] = await this.#database
      .select()
      .from(documentTransferAuthorizations)
      .where(
        and(
          eq(documentTransferAuthorizations.tokenHash, tokenHash),
          eq(documentTransferAuthorizations.operation, operation),
          isNull(documentTransferAuthorizations.consumedAt),
          gt(documentTransferAuthorizations.expiresAt, now),
        ),
      )
      .limit(1);
    return authorization ?? null;
  }

  async findUploadForFinalization(
    principal: UserPrincipal,
    transferId: string,
    now: Date,
  ): Promise<DocumentTransferAuthorizationRow | null> {
    const [authorization] = await this.#database
      .select()
      .from(documentTransferAuthorizations)
      .where(
        and(
          eq(documentTransferAuthorizations.id, transferId),
          eq(documentTransferAuthorizations.workspaceId, principal.workspaceId),
          eq(documentTransferAuthorizations.authorizedBy, principal.userId),
          eq(documentTransferAuthorizations.operation, "upload"),
          isNull(documentTransferAuthorizations.finalizedAt),
        ),
      )
      .limit(1);
    if (
      authorization === undefined ||
      (authorization.consumedAt === null && authorization.expiresAt <= now)
    )
      return null;
    return authorization;
  }

  async listAttachmentRelations(
    principal: UserPrincipal,
    parentObjectId: string,
  ): Promise<AttachmentRelation[]> {
    return this.#database
      .select({
        documentId: objectRelations.sourceObjectId,
        relationId: objectRelations.id,
        relationVersion: objectRelations.version,
      })
      .from(objectRelations)
      .innerJoin(
        objects,
        and(
          eq(objects.workspaceId, objectRelations.workspaceId),
          eq(objects.id, objectRelations.sourceObjectId),
          eq(objects.objectType, "document"),
          isNull(objects.deletedAt),
        ),
      )
      .where(
        and(
          eq(objectRelations.workspaceId, principal.workspaceId),
          eq(objectRelations.relationType, "attached_to"),
          eq(objectRelations.targetObjectId, parentObjectId),
          isNull(objectRelations.deletedAt),
        ),
      );
  }
}
