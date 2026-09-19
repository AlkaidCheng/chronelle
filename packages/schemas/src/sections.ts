import { z } from "zod";

const objectIdSchema = z.uuid();
const dateTimeResponseSchema = z.iso.datetime();

/** The views of an Event that split into sections. */
export const sectionViewSchema = z.enum(["todos", "expenses"]);

/** A section's name, 1 to 120 characters without surrounding spaces. */
export const sectionNameSchema = z.string().trim().min(1).max(120);

/** Plain text under the name, up to 2,000 characters; an empty one is none. */
const sectionDescriptionSchema = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .transform((value) => (value === "" ? null : value));

export const sectionListQuerySchema = z.object({
  view: sectionViewSchema,
});

export const sectionCreateRequestSchema = z.object({
  view: sectionViewSchema,
  name: sectionNameSchema,
  description: sectionDescriptionSchema.optional(),
  /** The section to place it after; null puts it first; absent puts it last. */
  afterSectionId: objectIdSchema.nullable().optional(),
});

export const sectionUpdateRequestSchema = z
  .object({
    name: sectionNameSchema.optional(),
    description: sectionDescriptionSchema.optional(),
    /** The section to move it after; null moves it first; absent leaves it. */
    afterSectionId: objectIdSchema.nullable().optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    {
      message: "At least one update field is required.",
    },
  );

export const sectionResponseSchema = z.object({
  id: objectIdSchema,
  workspaceId: objectIdSchema,
  eventId: objectIdSchema,
  view: sectionViewSchema,
  name: z.string(),
  description: z.string().nullable().default(null),
  /** The section's place among its siblings. */
  rank: z.string(),
  createdAt: dateTimeResponseSchema,
  updatedAt: dateTimeResponseSchema,
});

export const sectionListResponseSchema = z.object({
  items: z.array(sectionResponseSchema),
});

export type SectionView = z.infer<typeof sectionViewSchema>;
export type SectionListQuery = z.infer<typeof sectionListQuerySchema>;
export type SectionCreateRequest = z.infer<typeof sectionCreateRequestSchema>;
export type SectionUpdateRequest = z.infer<typeof sectionUpdateRequestSchema>;
export type SectionResponse = z.infer<typeof sectionResponseSchema>;
export type SectionListResponse = z.infer<typeof sectionListResponseSchema>;
