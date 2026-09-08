import { z } from "zod";

export const eventComponentKindSchema = z.enum([
  "todos",
  "calendar",
  "timeline",
  "itinerary",
  "expenses",
  "reminders",
  "files",
]);

export type EventComponentKind = z.output<typeof eventComponentKindSchema>;

export const eventPageSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  components: z
    .array(
      z.strictObject({
        id: z.uuid(),
        kind: eventComponentKindSchema,
      }),
    )
    .max(20),
});

export const eventPagesSchema = z
  .array(eventPageSchema)
  .max(20)
  .superRefine((pages, context) => {
    const ids = pages.flatMap((page) => [
      page.id,
      ...page.components.map((component) => component.id),
    ]);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Page and component IDs must be unique.",
      });
    }
    if (
      pages.reduce((count, page) => count + page.components.length, 0) > 100
    ) {
      context.addIssue({
        code: "custom",
        message: "An event supports up to 100 components.",
      });
    }
  });

export const eventLayoutUpdateSchema = z.strictObject({
  expectedVersion: z.int().min(0).max(2_147_483_646),
  pages: eventPagesSchema,
});

export const eventLayoutResponseSchema = z.strictObject({
  eventId: z.uuid(),
  version: z.int().nonnegative(),
  updatedAt: z.iso.datetime().nullable(),
  pages: eventPagesSchema,
});

export type EventPage = z.output<typeof eventPageSchema>;
export type EventLayoutUpdate = z.output<typeof eventLayoutUpdateSchema>;
export type EventLayoutResponse = z.output<typeof eventLayoutResponseSchema>;

export const eventLayoutHistoryQuerySchema = z.strictObject({
  beforeVersion: z.coerce.number().int().min(1).max(2_147_483_647).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
export const eventLayoutHistoryResponseSchema = z.strictObject({
  items: z.array(eventLayoutResponseSchema).max(20),
  nextBeforeVersion: z.int().positive().nullable(),
});
export const eventLayoutRestoreSchema = z.strictObject({
  expectedVersion: z.int().min(0).max(2_147_483_646),
  targetVersion: z.int().min(0).max(2_147_483_647),
});
export type EventLayoutHistoryQuery = z.output<
  typeof eventLayoutHistoryQuerySchema
>;
export type EventLayoutHistoryQueryInput = z.input<
  typeof eventLayoutHistoryQuerySchema
>;
export type EventLayoutHistoryResponse = z.output<
  typeof eventLayoutHistoryResponseSchema
>;
export type EventLayoutRestore = z.output<typeof eventLayoutRestoreSchema>;
