import { z } from "zod";
import { relationResponseSchema } from "./event-planning.js";
import { cursorTokenSchema } from "./pagination.js";
import { relationTypeSchema } from "./relation-list.js";

const versionSchema = z.number().int().positive().max(2_147_483_647);
export const recoveryRequestSchema = z
  .object({ expectedVersion: versionSchema })
  .strict();
export const relationDeletionQuerySchema = z
  .object({
    expectedVersion: z.coerce.number().pipe(versionSchema),
  })
  .strict();
export const trashQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: cursorTokenSchema.optional(),
    objectType: z
      .enum(["event", "task", "expense", "reminder", "document", "person"])
      .optional(),
    scopeId: z.uuid().optional(),
  })
  .strict();
export const removedRelationQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: cursorTokenSchema.optional(),
  relationType: relationTypeSchema.optional(),
});
export const trashItemSchema = z.object({
  id: z.uuid(),
  objectType: z.enum([
    "event",
    "task",
    "expense",
    "reminder",
    "document",
    "person",
  ]),
  displayName: z.string(),
  version: versionSchema,
  deletedAt: z.iso.datetime(),
});
export const trashListResponseSchema = z.object({
  items: z.array(trashItemSchema),
  nextCursor: cursorTokenSchema.nullable(),
});
/** Internal position only; current recovery permission is checked per page. */
export const trashCursorSchema = z.strictObject({
  formatVersion: z.literal(1),
  context: z.string().regex(/^[a-f0-9]{64}$/),
  id: z.uuid(),
});
export const recoveryPreviewSchema = z.object({
  object: trashItemSchema,
  canRecover: z.boolean(),
  blockedReason: z.string().nullable(),
});
export const removedRelationListResponseSchema = z.object({
  items: z.array(
    z.object({
      relation: relationResponseSchema,
      sourceDisplayName: z.string(),
      targetDisplayName: z.string(),
    }),
  ),
  nextCursor: cursorTokenSchema.nullable(),
});
export type RecoveryRequest = z.infer<typeof recoveryRequestSchema>;
export type TrashQuery = z.output<typeof trashQuerySchema>;
export type TrashQueryInput = z.input<typeof trashQuerySchema>;
export type TrashItem = z.infer<typeof trashItemSchema>;
export type TrashListResponse = z.infer<typeof trashListResponseSchema>;
export type RecoveryPreview = z.infer<typeof recoveryPreviewSchema>;
export type RemovedRelationListResponse = z.infer<
  typeof removedRelationListResponseSchema
>;
export type RemovedRelationQuery = z.output<typeof removedRelationQuerySchema>;
export type RemovedRelationQueryInput = z.input<
  typeof removedRelationQuerySchema
>;
