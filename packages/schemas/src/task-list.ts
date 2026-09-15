import { z } from "zod";
import { cursorTimestampSchema, cursorTokenSchema } from "./pagination.js";

/**
 * The workspace Task collection: every Task the caller may view, whether it
 * lives on its own or inside an Event. `filter` selects by status, `sort`
 * by due (date-only tasks at the start of their day, undated last), name,
 * or last update.
 */
export const taskListQuerySchema = z.object({
  cursor: cursorTokenSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  query: z.string().trim().max(240).default(""),
  filter: z.enum(["open", "all", "done"]).default("open"),
  sort: z.enum(["due", "name", "updated"]).default("due"),
  /** Only tasks carrying this label. */
  label: z.uuid().optional(),
});

/** Internal position only; authorization is evaluated again on every page. */
export const taskListCursorSchema = z.strictObject({
  formatVersion: z.literal(1),
  context: z.string().regex(/^[a-f0-9]{64}$/),
  asOf: cursorTimestampSchema,
  id: z.uuid(),
  name: z.string().max(720),
  dueAt: cursorTimestampSchema.nullable(),
  updatedAt: cursorTimestampSchema,
});

export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
export type TaskListQueryInput = z.input<typeof taskListQuerySchema>;
export type TaskListCursor = z.infer<typeof taskListCursorSchema>;
