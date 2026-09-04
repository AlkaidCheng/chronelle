import { z } from "zod";

import { documentResponseSchema } from "./event-planning.js";

export const maximumDocumentSizeBytes = 25 * 1024 * 1024;

const objectIdSchema = z.uuid();
const checksumSha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const originalFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      value !== "." &&
      value !== ".." &&
      !value.includes("/") &&
      !value.includes("\\") &&
      Array.from(value).every((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint > 31 && codePoint !== 127;
      }),
    "The filename must not contain path separators or control characters.",
  );
const mimeTypeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/,
  );
const transferSchema = z.object({
  expiresAt: z.iso.datetime(),
  headers: z.record(z.string(), z.string()),
  method: z.enum(["GET", "PUT"]),
  url: z.string().min(1),
});

export const documentUploadAuthorizationRequestSchema = z.object({
  checksumSha256: checksumSha256Schema,
  mimeType: mimeTypeSchema,
  originalFilename: originalFilenameSchema,
  parentObjectId: objectIdSchema,
  sizeBytes: z.number().int().nonnegative().max(maximumDocumentSizeBytes),
});

export const documentUploadAuthorizationResponseSchema = z.object({
  id: objectIdSchema,
  upload: transferSchema.extend({ method: z.literal("PUT") }),
});

export const documentUploadFinalizationRequestSchema = z.object({
  uploadAuthorizationId: objectIdSchema,
});

export const documentAttachmentResponseSchema = z.object({
  document: documentResponseSchema,
  relationId: objectIdSchema,
});

export const documentAttachmentListResponseSchema = z.object({
  items: z.array(documentAttachmentResponseSchema),
  lockedAttachmentCount: z.number().int().nonnegative(),
});

export const documentDownloadAuthorizationResponseSchema = z.object({
  download: transferSchema.extend({ method: z.literal("GET") }),
});

export const documentTransferTokenParamsSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
});

export type DocumentUploadAuthorizationRequest = z.infer<
  typeof documentUploadAuthorizationRequestSchema
>;
export type DocumentUploadAuthorizationPayload = z.input<
  typeof documentUploadAuthorizationRequestSchema
>;
export type DocumentUploadAuthorizationResponse = z.infer<
  typeof documentUploadAuthorizationResponseSchema
>;
export type DocumentUploadFinalizationRequest = z.infer<
  typeof documentUploadFinalizationRequestSchema
>;
export type DocumentAttachmentResponse = z.infer<
  typeof documentAttachmentResponseSchema
>;
export type DocumentAttachmentListResponse = z.infer<
  typeof documentAttachmentListResponseSchema
>;
export type DocumentDownloadAuthorizationResponse = z.infer<
  typeof documentDownloadAuthorizationResponseSchema
>;
