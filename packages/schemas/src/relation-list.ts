import { z } from "zod";
import { cursorTokenSchema } from "./pagination.js";

export const relationTypeSchema = z.enum([
  "includes",
  "reminds_about",
  "attached_to",
  "related_to",
]);

export const relationListQuerySchema = z.object({
  cursor: cursorTokenSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  direction: z.enum(["both", "incoming", "outgoing"]).default("both"),
  relationType: relationTypeSchema.optional(),
  otherObjectId: z.uuid().optional(),
});

/** Internal position only; authorization is evaluated again on every page. */
export const relationListCursorSchema = z.strictObject({
  formatVersion: z.literal(1),
  context: z.string().regex(/^[a-f0-9]{64}$/),
  id: z.uuid(),
});

export type RelationListQueryInput = z.input<typeof relationListQuerySchema>;
export type RelationListCursor = z.infer<typeof relationListCursorSchema>;
