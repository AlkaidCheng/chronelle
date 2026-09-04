import { z } from "zod";

const objectTypeSchema = z.enum([
  "event",
  "task",
  "expense",
  "reminder",
  "document",
]);

export const objectSearchQuerySchema = z.object({
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
});

export type ObjectSearchQuery = z.infer<typeof objectSearchQuerySchema>;
export type ObjectSearchQueryInput = z.input<typeof objectSearchQuerySchema>;
export type ObjectSearchResponse = z.infer<typeof objectSearchResponseSchema>;
export type ObjectSearchResult = z.infer<typeof objectSearchResultSchema>;
