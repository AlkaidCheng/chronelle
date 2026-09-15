import { z } from "zod";

const objectIdSchema = z.uuid();
const dateTimeResponseSchema = z.iso.datetime();

/** A workspace-level name a Task may carry; unique per workspace, case-insensitively. */
export const labelNameSchema = z.string().trim().min(1).max(40);

export const labelCreateRequestSchema = z.object({
  name: labelNameSchema,
});

export const labelUpdateRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  name: labelNameSchema,
});

export const labelDeleteQuerySchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
});

export const labelResponseSchema = z.object({
  id: objectIdSchema,
  workspaceId: objectIdSchema,
  name: z.string(),
  version: z.number().int().positive(),
  createdAt: dateTimeResponseSchema,
  updatedAt: dateTimeResponseSchema,
});

export const labelListResponseSchema = z.object({
  items: z.array(labelResponseSchema),
});

export type LabelCreateRequest = z.infer<typeof labelCreateRequestSchema>;
export type LabelUpdateRequest = z.infer<typeof labelUpdateRequestSchema>;
export type LabelResponse = z.infer<typeof labelResponseSchema>;
export type LabelListResponse = z.infer<typeof labelListResponseSchema>;
