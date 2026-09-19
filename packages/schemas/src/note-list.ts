import { z } from "zod";

import { noteResponseSchema } from "./event-planning.js";

/**
 * The Notes an Event includes that the caller may view: last edited first,
 * or by title. Each item carries the display name of the account whose
 * revision is the note's current version, or null when that account is
 * not known.
 */
export const noteListQuerySchema = z.object({
  sort: z.enum(["edited", "title"]).default("edited"),
});

export const noteListItemSchema = noteResponseSchema.extend({
  editedBy: z.string().nullable().default(null),
});

export const noteListResponseSchema = z.object({
  sourceEventId: z.uuid(),
  items: z.array(noteListItemSchema),
});

export type NoteListQuery = z.infer<typeof noteListQuerySchema>;
export type NoteListQueryInput = z.input<typeof noteListQuerySchema>;
export type NoteListItem = z.infer<typeof noteListItemSchema>;
export type NoteListResponse = z.infer<typeof noteListResponseSchema>;
