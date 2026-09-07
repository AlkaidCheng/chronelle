import { z } from "zod";

const objectTypeSchema = z.enum([
  "event",
  "task",
  "expense",
  "reminder",
  "document",
]);

export const objectSearchQuerySchema = z.object({
  cursor: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  objectType: objectTypeSchema.optional(),
  query: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .refine((value) => /[\p{L}\p{N}]/u.test(value)),
});

export const objectSearchResultSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  objectType: objectTypeSchema,
  permissionScopeId: z.uuid(),
  updatedAt: z.iso.datetime(),
  version: z.number().int().positive(),
});

export const objectSearchResponseSchema = z.object({
  items: z.array(objectSearchResultSchema),
  nextCursor: z.string().nullable(),
});

/** Internal cursor envelope; positions never substitute for authorization. */
export const objectSearchCursorPayloadSchema = z.strictObject({
  formatVersion: z.literal(1),
  userId: z.uuid(),
  workspaceId: z.uuid(),
  query: objectSearchQuerySchema.shape.query,
  objectType: objectTypeSchema.nullable(),
  id: z.uuid(),
  rank: z.number().min(0).max(3.4028234663852886e38),
  // PostgreSQL timestamps have no year zero.
  updatedAt: z.iso
    .datetime({ precision: 6 })
    .refine((value) => !value.startsWith("0000-")),
});

export type ObjectSearchCursorPayload = z.infer<
  typeof objectSearchCursorPayloadSchema
>;

export type ObjectSearchQuery = z.infer<typeof objectSearchQuerySchema>;
export type ObjectSearchQueryInput = z.input<typeof objectSearchQuerySchema>;
export type ObjectSearchResponse = z.infer<typeof objectSearchResponseSchema>;
export type ObjectSearchResult = z.infer<typeof objectSearchResultSchema>;
