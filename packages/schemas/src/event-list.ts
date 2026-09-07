import { z } from "zod";
import { cursorTimestampSchema, cursorTokenSchema } from "./pagination.js";

export const eventListQuerySchema = z.object({
  cursor: cursorTokenSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  query: z.string().trim().max(240).default(""),
  filter: z.enum(["all", "upcoming", "unscheduled", "past"]).default("all"),
  sort: z.enum(["date", "name", "updated"]).default("date"),
});

/** Internal position only; authorization is evaluated again on every page. */
export const eventListCursorSchema = z.strictObject({
  formatVersion: z.literal(1),
  context: z.string().regex(/^[a-f0-9]{64}$/),
  asOf: cursorTimestampSchema,
  id: z.uuid(),
  name: z.string().max(720),
  startsAt: cursorTimestampSchema.nullable(),
  updatedAt: cursorTimestampSchema,
});

export type EventListQuery = z.infer<typeof eventListQuerySchema>;
export type EventListQueryInput = z.input<typeof eventListQuerySchema>;
export type EventListCursor = z.infer<typeof eventListCursorSchema>;
