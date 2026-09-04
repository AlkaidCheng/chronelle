import type {
  DocumentAttachmentResource,
  DocumentService,
  MutationContext,
} from "@chronelle/object-model";
import {
  documentAttachmentListResponseSchema,
  documentAttachmentResponseSchema,
  documentDownloadAuthorizationResponseSchema,
  documentTransferTokenParamsSchema,
  documentUploadAuthorizationRequestSchema,
  documentUploadAuthorizationResponseSchema,
  documentUploadFinalizationRequestSchema,
  maximumDocumentSizeBytes,
  objectIdParamsSchema,
} from "@chronelle/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { serializeResource } from "../event-planning/serialization.js";
import { InvalidRequestError } from "../errors.js";
import { requirePrincipal } from "../request-context.js";
import { parseRequest } from "../request-validation.js";

export interface DocumentRouteDependencies {
  readonly documents: DocumentService;
}

function mutationContext(request: FastifyRequest): MutationContext {
  return { principal: requirePrincipal(request), requestId: request.id };
}

function serializeAttachment(attachment: DocumentAttachmentResource) {
  return {
    document: serializeResource(attachment.document),
    relationId: attachment.relationId,
  };
}

function serializeTransfer(transfer: {
  readonly expiresAt: Date;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: "GET" | "PUT";
  readonly url: string;
}) {
  return { ...transfer, expiresAt: transfer.expiresAt.toISOString() };
}

export function registerDocumentRoutes(
  app: FastifyInstance,
  dependencies: DocumentRouteDependencies,
): void {
  app.addContentTypeParser(
    "application/octet-stream",
    { bodyLimit: maximumDocumentSizeBytes, parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );

  app.post(
    "/api/documents/upload-url",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const input = parseRequest(
        documentUploadAuthorizationRequestSchema,
        request.body,
      );
      const authorization = await dependencies.documents.authorizeUpload(
        mutationContext(request),
        input,
      );
      return reply.code(201).send(
        documentUploadAuthorizationResponseSchema.parse({
          id: authorization.id,
          upload: serializeTransfer(authorization.upload),
        }),
      );
    },
  );

  app.put(
    "/api/document-transfers/upload/:token",
    { bodyLimit: maximumDocumentSizeBytes },
    async (request, reply) => {
      const { token } = parseRequest(
        documentTransferTokenParamsSchema,
        request.params,
      );
      if (!Buffer.isBuffer(request.body)) {
        throw new InvalidRequestError();
      }
      await dependencies.documents.receiveUpload(
        token,
        request.body,
        request.id,
      );
      return reply.code(204).send();
    },
  );

  app.post(
    "/api/documents",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { uploadAuthorizationId } = parseRequest(
        documentUploadFinalizationRequestSchema,
        request.body,
      );
      const attachment = await dependencies.documents.finalizeUpload(
        mutationContext(request),
        uploadAuthorizationId,
      );
      return reply
        .code(201)
        .send(
          documentAttachmentResponseSchema.parse(
            serializeAttachment(attachment),
          ),
        );
    },
  );

  app.get(
    "/api/objects/:id/documents",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const attachments = await dependencies.documents.listAttachments(
        requirePrincipal(request),
        id,
      );
      return documentAttachmentListResponseSchema.parse({
        items: attachments.items.map(serializeAttachment),
        lockedAttachmentCount: attachments.lockedAttachmentCount,
      });
    },
  );

  app.get(
    "/api/documents/:id/download-url",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const authorization = await dependencies.documents.authorizeDownload(
        mutationContext(request),
        id,
      );
      return documentDownloadAuthorizationResponseSchema.parse({
        download: serializeTransfer(authorization.download),
      });
    },
  );

  app.get("/api/document-transfers/download/:token", async (request, reply) => {
    const { token } = parseRequest(
      documentTransferTokenParamsSchema,
      request.params,
    );
    const download = await dependencies.documents.consumeDownload(
      token,
      request.id,
    );
    return reply
      .header("cache-control", "private, no-store")
      .header(
        "content-disposition",
        `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(download.originalFilename)}`,
      )
      .type(download.mimeType)
      .send(Buffer.from(download.bytes));
  });
}
