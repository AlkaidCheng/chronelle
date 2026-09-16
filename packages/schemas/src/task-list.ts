import { z } from "zod";
import { calendarDateSchema } from "./event-calendar-dates.js";
import { cursorTimestampSchema, cursorTokenSchema } from "./pagination.js";

/** An IANA time zone name the runtime knows. */
export const timeZoneSchema = z
  .string()
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone.");

/**
 * The workspace Task collection: every Task the caller may view, whether it
 * lives on its own or inside an Event. `filter` selects by status, `sort`
 * by due (date-only tasks at the start of their day, undated last), name,
 * last update, or manual order (rank). `dueFrom` and `dueTo` keep the tasks due on a day of that
 * inclusive range, a timed task on the day of its instant in `timezone`;
 * undated tasks are left out of a range.
 */
export const taskListQuerySchema = z
  .object({
    cursor: cursorTokenSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    query: z.string().trim().max(240).default(""),
    filter: z.enum(["open", "all", "done"]).default("open"),
    sort: z.enum(["due", "name", "updated", "manual"]).default("due"),
    /** Only tasks carrying this label. */
    label: z.uuid().optional(),
    /** Only tasks assigned to this Person. */
    assignee: z.uuid().optional(),
    /** Only tasks due on or after this day. */
    dueFrom: calendarDateSchema.optional(),
    /** Only tasks due on or before this day. */
    dueTo: calendarDateSchema.optional(),
    /** The time zone whose days `dueFrom` and `dueTo` name. */
    timezone: timeZoneSchema.default("UTC"),
  })
  .refine(
    (value) =>
      value.dueFrom === undefined ||
      value.dueTo === undefined ||
      value.dueFrom <= value.dueTo,
    "dueTo must not precede dueFrom.",
  );

/** Internal position only; authorization is evaluated again on every page. */
export const taskListCursorSchema = z.strictObject({
  formatVersion: z.literal(1),
  context: z.string().regex(/^[a-f0-9]{64}$/),
  asOf: cursorTimestampSchema,
  id: z.uuid(),
  name: z.string().max(720),
  dueAt: cursorTimestampSchema.nullable(),
  updatedAt: cursorTimestampSchema,
  rank: z.string().max(64).default(""),
});

export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
export type TaskListQueryInput = z.input<typeof taskListQuerySchema>;
export type TaskListCursor = z.infer<typeof taskListCursorSchema>;
