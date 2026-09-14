import { createHash, randomBytes } from "node:crypto";

import {
  AuthorizationDeniedError,
  withStableAuthorization,
  withReadAuthorization,
  type AuthorizationAction,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  createId,
  documents,
  documentTransferAuthorizations,
  objectRelations,
  objects,
  runAuditedMutation,
  type Database,
  type DocumentTransferAuthorizationRow,
} from "@chronelle/db";
import {
  StorageObjectUnavailableError,
  type StorageProvider,
  type StoredObjectMetadata,
  type StorageTransferProvider,
} from "@chronelle/storage";
import { and, eq, gt, isNull } from "drizzle-orm";

import {
  PostgresDocumentTransferReadRepository,
  type DocumentTransferAuthorization,
  type DocumentTransferOperation,
  type DocumentTransferReadRepository,
  type DocumentTransferWriteRepository,
} from "./document-transfers.js";
import {
  DocumentTransferUnavailableError,
  InvalidDocumentUploadError,
} from "./errors.js";
import { EventPlanningObjectService } from "./object-service.js";
import { readObjectState } from "./object-state.js";
import { recordObjectRevision } from "./object-revisions.js";
import type {
  DocumentAttachmentList,
  DocumentAttachmentResource,
  DocumentDownloadAuthorizationResource,
  DocumentDownloadResource,
  DocumentUploadAuthorizationInput,
  DocumentUploadAuthorizationResource,
  EventPlanningResource,
  MutationContext,
} from "./types.js";

const attachmentParentTypes = new Set(["event", "task", "expense"]);

function hashCredential(credential: string): string {
  return createHash("sha256").update(credential).digest("hex");
}

function checksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function createCredential(): string {
  return randomBytes(32).toString("base64url");
}

function createStorageKey(
  workspaceId: string,
  authorizationId: string,
): string {
  return `workspaces/${workspaceId}/documents/${authorizationId}`;
}

function isAttachmentParent(resource: EventPlanningResource): boolean {
  return attachmentParentTypes.has(resource.objectType);
}

/** Visible attachments newest first, and how many relations the principal cannot see. */
function attachmentList(
  relations: readonly {
    readonly documentId: string;
    readonly relationId: string;
    readonly relationVersion: number;
  }[],
  resources: readonly EventPlanningResource[],
): DocumentAttachmentList {
  const documentsById = new Map(
    resources.map((resource) => [resource.id, resource]),
  );
  const visible = relations
    .flatMap(
      ({
        documentId,
        relationId,
        relationVersion,
      }): DocumentAttachmentResource[] => {
        const document = documentsById.get(documentId);
        return document?.objectType === "document"
          ? [{ document, relationId, relationVersion }]
          : [];
      },
    )
    .sort(
      (first, second) =>
        second.document.createdAt.getTime() -
          first.document.createdAt.getTime() ||
        first.document.id.localeCompare(second.document.id),
    );
  return {
    items: visible,
    lockedAttachmentCount: relations.length - visible.length,
  };
}

export interface DocumentServiceOptions {
  readonly clock?: (() => Date) | undefined;
  readonly transferTtlMs?: number | undefined;
  /** The transfer rows and the attachment records; PostgreSQL when absent. */
  readonly writes?: DocumentTransferWriteRepository | undefined;
  /** The transfer lookups and attachment relations; PostgreSQL when absent. */
  readonly reads?: DocumentTransferReadRepository | undefined;
}

/**
 * Attachments: signed uploads and downloads against the storage provider,
 * with every row DocumentService writes around them recorded in one
 * transaction. The PostgreSQL implementation is this class's own
 * transactional code, used whenever no write repository is injected; the
 * object service supplies the authorization decisions.
 */
export class DocumentService {
  readonly #clock: () => Date;
  readonly #database: Database;
  readonly #objects: EventPlanningObjectService;
  readonly #storage: StorageProvider;
  readonly #transferTtlMs: number;
  readonly #writes: DocumentTransferWriteRepository | undefined;
  readonly #reads: DocumentTransferReadRepository | undefined;
  readonly #transfers: DocumentTransferReadRepository;

  constructor(
    database: Database,
    objectsService: EventPlanningObjectService,
    storage: StorageProvider,
    options: DocumentServiceOptions = {},
  ) {
    this.#database = database;
    this.#objects = objectsService;
    this.#storage = storage;
    this.#clock = options.clock ?? (() => new Date());
    this.#transferTtlMs = options.transferTtlMs ?? 5 * 60_000;
    this.#writes = options.writes;
    this.#reads = options.reads;
    this.#transfers =
      options.reads ?? new PostgresDocumentTransferReadRepository(database);
  }

  async authorizeUpload(
    context: MutationContext,
    input: DocumentUploadAuthorizationInput,
  ): Promise<DocumentUploadAuthorizationResource> {
    await this.#getAttachmentParent(
      context.principal,
      input.parentObjectId,
      "edit",
    );

    const id = createId();
    const credential = createCredential();
    const createdAt = this.#clock();
    const expiresAt = new Date(createdAt.getTime() + this.#transferTtlMs);
    const storageKey = createStorageKey(context.principal.workspaceId, id);
    const upload = await this.#storage.createUploadAuthorization({
      checksumSha256: input.checksumSha256,
      credential,
      expiresAt,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storageKey,
    });

    await this.#authorizeTransfer(context, "edit", {
      id,
      operation: "upload",
      tokenHash: hashCredential(credential),
      resourceId: input.parentObjectId,
      storageProvider: this.#storage.providerId,
      storageKey,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      sizeBytes: BigInt(input.sizeBytes),
      checksumSha256: input.checksumSha256,
      createdAt,
      expiresAt,
    });

    return { id, upload: { ...upload, method: "PUT" } };
  }

  /** Records a transfer after re-checking the action on its resource, with its audit event. */
  async #authorizeTransfer(
    context: MutationContext,
    action: AuthorizationAction,
    transfer: DocumentTransferAuthorization,
  ): Promise<void> {
    if (this.#writes !== undefined)
      return this.#writes.authorize(context, transfer);
    await withStableAuthorization(
      this.#database,
      context.principal.workspaceId,
      async (transaction, authorization) => {
        await authorization.assertCan(context.principal, action, {
          id: transfer.resourceId,
          workspaceId: context.principal.workspaceId,
        });
        return runAuditedMutation(transaction, async (transaction) => {
          await transaction.insert(documentTransferAuthorizations).values({
            ...transfer,
            workspaceId: context.principal.workspaceId,
            authorizedBy: context.principal.userId,
          });
          return {
            value: undefined,
            audit: {
              workspaceId: context.principal.workspaceId,
              actorType: "user",
              actorId: context.principal.userId,
              action: `document.${transfer.operation}_authorized`,
              resourceId: transfer.resourceId,
              requestId: context.requestId,
              metadata: { transferAuthorizationId: transfer.id },
            },
          };
        });
      },
    );
  }

  /** Consumes a transfer once, with its audit event naming the authorizer. */
  async #consumeTransfer(
    authorization: DocumentTransferAuthorizationRow,
    consumedAt: Date,
    requestId: string,
  ): Promise<void> {
    if (this.#writes !== undefined)
      return this.#writes.consume(authorization, consumedAt, requestId);
    await runAuditedMutation(this.#database, async (transaction) => {
      const [consumed] = await transaction
        .update(documentTransferAuthorizations)
        .set({ consumedAt })
        .where(
          and(
            eq(documentTransferAuthorizations.id, authorization.id),
            eq(
              documentTransferAuthorizations.operation,
              authorization.operation,
            ),
            isNull(documentTransferAuthorizations.consumedAt),
            gt(documentTransferAuthorizations.expiresAt, consumedAt),
          ),
        )
        .returning({ id: documentTransferAuthorizations.id });
      if (consumed === undefined) {
        throw new DocumentTransferUnavailableError();
      }
      return {
        value: undefined,
        audit: {
          workspaceId: authorization.workspaceId,
          actorType: "user",
          actorId: authorization.authorizedBy,
          action:
            authorization.operation === "upload"
              ? "document.uploaded"
              : "document.downloaded",
          resourceId: authorization.resourceId,
          requestId,
          metadata: { transferAuthorizationId: authorization.id },
        },
      };
    });
  }

  async receiveUpload(
    credential: string,
    bytes: Uint8Array,
    requestId: string,
  ): Promise<void> {
    const now = this.#clock();
    const authorization = await this.#findTransferByCredential(
      credential,
      "upload",
      now,
    );
    if (
      authorization.sizeBytes !== BigInt(bytes.byteLength) ||
      authorization.checksumSha256 !== checksum(bytes)
    ) {
      throw new InvalidDocumentUploadError(
        "The uploaded bytes do not match the authorized size and checksum.",
      );
    }

    const storage = this.#requireTransferProvider(authorization);
    await storage.writeObject(authorization.storageKey, bytes, {
      checksumSha256: authorization.checksumSha256,
      sizeBytes: Number(authorization.sizeBytes),
    });

    await this.#consumeTransfer(authorization, now, requestId);
  }

  async finalizeUpload(
    context: MutationContext,
    uploadAuthorizationId: string,
  ): Promise<DocumentAttachmentResource> {
    const authorization = await this.#findUploadForFinalization(
      context.principal,
      uploadAuthorizationId,
    );
    await this.#getAttachmentParent(
      context.principal,
      authorization.resourceId,
      "edit",
    );
    this.#assertStorageProvider(authorization);

    let storedObject: StoredObjectMetadata;
    try {
      storedObject = await this.#storage.inspectObject(
        authorization.storageKey,
      );
    } catch (error) {
      if (error instanceof StorageObjectUnavailableError) {
        throw new DocumentTransferUnavailableError();
      }
      throw error;
    }
    if (
      storedObject.sizeBytes !== Number(authorization.sizeBytes) ||
      storedObject.checksumSha256 !== authorization.checksumSha256
    ) {
      throw new InvalidDocumentUploadError(
        "The stored object does not match the authorized file metadata.",
      );
    }

    const documentId = createId();
    const relationId = createId();
    const finalizedAt = this.#clock();
    if (this.#writes !== undefined)
      return this.#writes.finalize(
        context,
        authorization,
        documentId,
        relationId,
        finalizedAt,
        this.#storage.encryptionMode,
      );
    return withStableAuthorization(
      this.#database,
      context.principal.workspaceId,
      async (transaction, currentAuthorization) => {
        await currentAuthorization.assertCan(context.principal, "edit", {
          id: authorization.resourceId,
          workspaceId: context.principal.workspaceId,
        });
        const parent = await readObjectState(
          transaction,
          context.principal.workspaceId,
          authorization.resourceId,
        );
        if (!isAttachmentParent(parent)) throw new AuthorizationDeniedError();
        const permissionScopeId = parent.permissionScopeId;
        const [finalized] = await transaction
          .update(documentTransferAuthorizations)
          .set({
            consumedAt: authorization.consumedAt ?? finalizedAt,
            finalizedAt,
          })
          .where(
            and(
              eq(documentTransferAuthorizations.id, authorization.id),
              isNull(documentTransferAuthorizations.finalizedAt),
            ),
          )
          .returning({ id: documentTransferAuthorizations.id });
        if (finalized === undefined) {
          throw new DocumentTransferUnavailableError();
        }

        await transaction.insert(objects).values({
          id: documentId,
          workspaceId: context.principal.workspaceId,
          objectType: "document",
          displayName: authorization.originalFilename,
          createdBy: context.principal.userId,
          permissionScopeId,
        });
        await transaction.insert(documents).values({
          objectId: documentId,
          workspaceId: context.principal.workspaceId,
          storageProvider: authorization.storageProvider,
          storageKey: authorization.storageKey,
          originalFilename: authorization.originalFilename,
          mimeType: authorization.mimeType,
          sizeBytes: authorization.sizeBytes,
          checksumSha256: authorization.checksumSha256,
          encryptionMode: this.#storage.encryptionMode,
        });
        await transaction.insert(objectRelations).values({
          id: relationId,
          workspaceId: context.principal.workspaceId,
          sourceObjectId: documentId,
          relationType: "attached_to",
          targetObjectId: parent.id,
          createdBy: context.principal.userId,
        });

        const document = await readObjectState(
          transaction,
          context.principal.workspaceId,
          documentId,
        );
        if (document.objectType !== "document")
          throw new Error("Expected a Document state.");
        await recordObjectRevision(
          transaction,
          document,
          {
            actorId: context.principal.userId,
            actorType: "user",
            requestId: context.requestId,
          },
          "created",
          {
            parentObjectId: parent.id,
            permissionScopeId,
            relationId,
            transferAuthorizationId: authorization.id,
          },
        );
        return { document, relationId, relationVersion: 1 };
      },
    );
  }

  async listAttachments(
    principal: UserPrincipal,
    parentObjectId: string,
  ): Promise<DocumentAttachmentList> {
    if (this.#reads !== undefined) {
      const parent = await this.#objects.getObject(principal, parentObjectId);
      if (!isAttachmentParent(parent)) throw new AuthorizationDeniedError();
      const relations = await this.#reads.listAttachmentRelations(
        principal,
        parentObjectId,
      );
      return attachmentList(
        relations,
        await this.#objects.listVisibleObjects(
          principal,
          relations.map(({ documentId }) => documentId),
        ),
      );
    }
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        const reader = new EventPlanningObjectService({
          database: transaction,
          authorization,
        });
        const parent = await reader.getObject(principal, parentObjectId);
        if (!isAttachmentParent(parent)) throw new AuthorizationDeniedError();
        const relations = await transaction
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

        return attachmentList(
          relations,
          await reader.listVisibleObjects(
            principal,
            relations.map(({ documentId }) => documentId),
          ),
        );
      },
    );
  }

  async authorizeDownload(
    context: MutationContext,
    documentId: string,
  ): Promise<DocumentDownloadAuthorizationResource> {
    const document = await this.#objects.getDocument(
      context.principal,
      documentId,
    );
    if (document.storageProvider !== this.#storage.providerId) {
      throw new DocumentTransferUnavailableError();
    }

    const credential = createCredential();
    const id = createId();
    const createdAt = this.#clock();
    const expiresAt = new Date(createdAt.getTime() + this.#transferTtlMs);
    const download = await this.#storage.createDownloadAuthorization({
      credential,
      expiresAt,
      mimeType: document.mimeType,
      originalFilename: document.originalFilename,
      storageKey: document.storageKey,
    });

    await this.#authorizeTransfer(context, "view", {
      id,
      operation: "download",
      tokenHash: hashCredential(credential),
      resourceId: document.id,
      storageProvider: document.storageProvider,
      storageKey: document.storageKey,
      originalFilename: document.originalFilename,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      checksumSha256: document.checksumSha256,
      createdAt,
      expiresAt,
    });

    return { download: { ...download, method: "GET" } };
  }

  async consumeDownload(
    credential: string,
    requestId: string,
  ): Promise<DocumentDownloadResource> {
    const now = this.#clock();
    const authorization = await this.#findTransferByCredential(
      credential,
      "download",
      now,
    );
    const principal: UserPrincipal = {
      type: "user",
      userId: authorization.authorizedBy,
      workspaceId: authorization.workspaceId,
    };
    await this.#assertAllowed(principal, "view", authorization.resourceId);
    const storage = this.#requireTransferProvider(authorization);
    const bytes = await storage.readObject(authorization.storageKey);
    if (
      bytes.byteLength !== Number(authorization.sizeBytes) ||
      checksum(bytes) !== authorization.checksumSha256
    ) {
      throw new DocumentTransferUnavailableError();
    }

    if (this.#writes !== undefined) {
      await this.#writes.consume(authorization, this.#clock(), requestId);
    } else {
      await withStableAuthorization(
        this.#database,
        principal.workspaceId,
        async (transaction, currentAuthorization) => {
          await currentAuthorization.assertCan(principal, "view", {
            id: authorization.resourceId,
            workspaceId: authorization.workspaceId,
          });
          const consumedAt = this.#clock();
          return runAuditedMutation(transaction, async (transaction) => {
            const [consumed] = await transaction
              .update(documentTransferAuthorizations)
              .set({ consumedAt })
              .where(
                and(
                  eq(documentTransferAuthorizations.id, authorization.id),
                  eq(documentTransferAuthorizations.operation, "download"),
                  isNull(documentTransferAuthorizations.consumedAt),
                  gt(documentTransferAuthorizations.expiresAt, consumedAt),
                ),
              )
              .returning({ id: documentTransferAuthorizations.id });
            if (consumed === undefined) {
              throw new DocumentTransferUnavailableError();
            }

            return {
              value: undefined,
              audit: {
                workspaceId: authorization.workspaceId,
                actorType: "user",
                actorId: authorization.authorizedBy,
                action: "document.downloaded",
                resourceId: authorization.resourceId,
                requestId,
                metadata: { transferAuthorizationId: authorization.id },
              },
            };
          });
        },
      );
    }

    return {
      bytes,
      mimeType: authorization.mimeType,
      originalFilename: authorization.originalFilename,
    };
  }

  /** The action must be among the principal's allowed actions on a live, viewable object. */
  async #assertAllowed(
    principal: UserPrincipal,
    action: AuthorizationAction,
    objectId: string,
  ): Promise<void> {
    const actions = await this.#objects.getAllowedActions(principal, objectId);
    if (!actions.includes(action)) throw new AuthorizationDeniedError();
  }

  async #getAttachmentParent(
    principal: UserPrincipal,
    objectId: string,
    action: AuthorizationAction,
  ): Promise<EventPlanningResource> {
    await this.#assertAllowed(principal, action, objectId);
    const parent = await this.#objects.getObject(principal, objectId);
    if (!isAttachmentParent(parent)) {
      throw new AuthorizationDeniedError();
    }
    return parent;
  }

  async #findTransferByCredential(
    credential: string,
    operation: DocumentTransferOperation,
    now: Date,
  ): Promise<DocumentTransferAuthorizationRow> {
    const authorization = await this.#transfers.findByCredential(
      hashCredential(credential),
      operation,
      now,
    );
    if (authorization === null) {
      throw new DocumentTransferUnavailableError();
    }
    return authorization;
  }

  async #findUploadForFinalization(
    principal: UserPrincipal,
    authorizationId: string,
  ): Promise<DocumentTransferAuthorizationRow> {
    const authorization = await this.#transfers.findUploadForFinalization(
      principal,
      authorizationId,
      this.#clock(),
    );
    if (authorization === null) {
      throw new DocumentTransferUnavailableError();
    }
    return authorization;
  }

  #assertStorageProvider(
    authorization: DocumentTransferAuthorizationRow,
  ): void {
    if (authorization.storageProvider !== this.#storage.providerId) {
      throw new DocumentTransferUnavailableError();
    }
  }

  #requireTransferProvider(
    authorization: DocumentTransferAuthorizationRow,
  ): StorageTransferProvider {
    this.#assertStorageProvider(authorization);
    if (!("writeObject" in this.#storage) || !("readObject" in this.#storage)) {
      throw new DocumentTransferUnavailableError();
    }
    return this.#storage as StorageTransferProvider;
  }
}
