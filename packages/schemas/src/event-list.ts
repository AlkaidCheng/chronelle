import { z } from "zod";
import { cursorTimestampSchema, cursorTokenSchema } from "./pagination.js";

/**
 * Which events the list covers: the caller's own workspace's, the ones
 * shared with the account from other workspaces, or both together.
 */
export const eventListScopeSchema = z.enum(["all", "mine", "shared"]);

export const eventListQuerySchema = z.object({
  cursor: cursorTokenSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  query: z.string().trim().max(240).default(""),
  scope: eventListScopeSchema.default("all"),
  filter: z.enum(["all", "upcoming", "unscheduled", "past"]).default("all"),
  sort: z.enum(["date", "name", "updated"]).default("date"),
});

/** How many events each filter chip would show for the typed query. */
export const eventListCountsSchema = z.object({
  all: z.number().int().nonnegative(),
  mine: z.number().int().nonnegative(),
  shared: z.number().int().nonnegative(),
  upcoming: z.number().int().nonnegative(),
  past: z.number().int().nonnegative(),
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

export type EventListScope = z.infer<typeof eventListScopeSchema>;
export type EventListCounts = z.infer<typeof eventListCountsSchema>;
export type EventListQuery = z.infer<typeof eventListQuerySchema>;
export type EventListQueryInput = z.input<typeof eventListQuerySchema>;
export type EventListCursor = z.infer<typeof eventListCursorSchema>;
