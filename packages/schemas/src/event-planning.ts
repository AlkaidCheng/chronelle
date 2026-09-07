import { z } from "zod";
import { cursorTokenSchema } from "./pagination.js";
import { relationTypeSchema } from "./relation-list.js";

const jsonObjectSchema = z.record(z.string(), z.unknown());
const objectIdSchema = z.uuid();
const dateTimeInputSchema = z.iso
  .datetime()
  .transform((value) => new Date(value));
const nullableDateTimeInputSchema = dateTimeInputSchema.nullable();
const dateTimeResponseSchema = z.iso.datetime();
const nullableDateTimeResponseSchema = dateTimeResponseSchema.nullable();

const objectTypeSchema = z.enum([
  "event",
  "task",
  "expense",
  "reminder",
  "document",
]);
const taskStatusSchema = z.enum(["todo", "in_progress", "done", "cancelled"]);
const reminderStatusSchema = z.enum([
  "pending",
  "triggered",
  "dismissed",
  "cancelled",
]);

const createObjectShape = {
  displayName: z.string().trim().min(1).max(240),
  permissionScopeId: objectIdSchema.optional(),
  customProperties: jsonObjectSchema.optional(),
  metadata: jsonObjectSchema.optional(),
};

const updateObjectShape = {
  expectedVersion: z.number().int().positive(),
  displayName: z.string().trim().min(1).max(240).optional(),
  customProperties: jsonObjectSchema.optional(),
  metadata: jsonObjectSchema.optional(),
};

function hasUpdateFields(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => key !== "expectedVersion");
}

export const objectIdParamsSchema = z.object({ id: objectIdSchema });

export const objectDeletionQuerySchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
});

export const eventCreateRequestSchema = z.object({
  ...createObjectShape,
  startsAt: nullableDateTimeInputSchema.optional(),
  endsAt: nullableDateTimeInputSchema.optional(),
  timezone: z.string().trim().min(1).max(120).nullable().optional(),
  isAllDay: z.boolean().optional(),
});

export const eventUpdateRequestSchema = z
  .object({
    ...updateObjectShape,
    startsAt: nullableDateTimeInputSchema.optional(),
    endsAt: nullableDateTimeInputSchema.optional(),
    timezone: z.string().trim().min(1).max(120).nullable().optional(),
    isAllDay: z.boolean().optional(),
  })
  .refine(hasUpdateFields, {
    message: "At least one update field is required.",
  });

export const taskCreateRequestSchema = z.object({
  ...createObjectShape,
  status: taskStatusSchema.optional(),
  dueAt: nullableDateTimeInputSchema.optional(),
  completedAt: nullableDateTimeInputSchema.optional(),
});

export const taskUpdateRequestSchema = z
  .object({
    ...updateObjectShape,
    status: taskStatusSchema.optional(),
    dueAt: nullableDateTimeInputSchema.optional(),
    completedAt: nullableDateTimeInputSchema.optional(),
  })
  .refine(hasUpdateFields, {
    message: "At least one update field is required.",
  });

const amountSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,15}(?:\.\d{1,4})?$/);
const currencySchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/));

export const expenseCreateRequestSchema = z.object({
  ...createObjectShape,
  amount: amountSchema,
  currency: currencySchema,
  occurredAt: dateTimeInputSchema,
});

export const expenseUpdateRequestSchema = z
  .object({
    ...updateObjectShape,
    amount: amountSchema.optional(),
    currency: currencySchema.optional(),
    occurredAt: dateTimeInputSchema.optional(),
  })
  .refine(hasUpdateFields, {
    message: "At least one update field is required.",
  });

export const reminderCreateRequestSchema = z.object({
  ...createObjectShape,
  remindAt: dateTimeInputSchema,
  status: reminderStatusSchema.optional(),
});

export const reminderUpdateRequestSchema = z
  .object({
    ...updateObjectShape,
    remindAt: dateTimeInputSchema.optional(),
    status: reminderStatusSchema.optional(),
  })
  .refine(hasUpdateFields, {
    message: "At least one update field is required.",
  });

export const relationCreateRequestSchema = z.object({
  relationType: relationTypeSchema,
  targetObjectId: objectIdSchema,
  metadata: jsonObjectSchema.optional(),
});

const canonicalObjectResponseShape = {
  id: objectIdSchema,
  workspaceId: objectIdSchema,
  objectType: objectTypeSchema,
  displayName: z.string(),
  createdBy: objectIdSchema,
  permissionScopeId: objectIdSchema,
  createdAt: dateTimeResponseSchema,
  updatedAt: dateTimeResponseSchema,
  version: z.number().int().positive(),
  archivedAt: nullableDateTimeResponseSchema,
  deletedAt: nullableDateTimeResponseSchema,
  customProperties: jsonObjectSchema,
  metadata: jsonObjectSchema,
};

export const eventResponseSchema = z.object({
  ...canonicalObjectResponseShape,
  objectType: z.literal("event"),
  startsAt: nullableDateTimeResponseSchema,
  endsAt: nullableDateTimeResponseSchema,
  timezone: z.string().nullable(),
  isAllDay: z.boolean(),
});

export const eventListResponseSchema = z.object({
  items: z.array(eventResponseSchema),
  nextCursor: cursorTokenSchema.nullable(),
  asOf: dateTimeResponseSchema,
});

export const taskResponseSchema = z.object({
  ...canonicalObjectResponseShape,
  objectType: z.literal("task"),
  status: taskStatusSchema,
  dueAt: nullableDateTimeResponseSchema,
  completedAt: nullableDateTimeResponseSchema,
});

export const expenseResponseSchema = z.object({
  ...canonicalObjectResponseShape,
  objectType: z.literal("expense"),
  amount: z.string(),
  currency: z.string(),
  occurredAt: dateTimeResponseSchema,
});

export const reminderResponseSchema = z.object({
  ...canonicalObjectResponseShape,
  objectType: z.literal("reminder"),
  remindAt: dateTimeResponseSchema,
  status: reminderStatusSchema,
});

export const documentResponseSchema = z.object({
  ...canonicalObjectResponseShape,
  objectType: z.literal("document"),
  storageProvider: z.string(),
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.string().regex(/^\d+$/),
  checksumSha256: z.string(),
  encryptionMode: z.string(),
});

export const eventPlanningResourceResponseSchema = z.discriminatedUnion(
  "objectType",
  [
    eventResponseSchema,
    taskResponseSchema,
    expenseResponseSchema,
    reminderResponseSchema,
    documentResponseSchema,
  ],
);

export const objectDeletionResponseSchema = z.object({
  id: objectIdSchema,
  version: z.number().int().positive(),
  deletedAt: dateTimeResponseSchema,
});

export const relationResponseSchema = z.object({
  version: z.number().int().positive(),
  id: objectIdSchema,
  workspaceId: objectIdSchema,
  sourceObjectId: objectIdSchema,
  relationType: relationTypeSchema,
  targetObjectId: objectIdSchema,
  metadata: jsonObjectSchema,
  createdBy: objectIdSchema,
  createdAt: dateTimeResponseSchema,
  deletedAt: nullableDateTimeResponseSchema,
});

export const relationListResponseSchema = z.object({
  items: z.array(relationResponseSchema),
  nextCursor: cursorTokenSchema.nullable(),
});

export const relationDeletionResponseSchema = z.object({
  version: z.number().int().positive(),
  id: objectIdSchema,
  deletedAt: dateTimeResponseSchema,
});

export const eventDetailResponseSchema = z.object({
  event: eventResponseSchema,
  events: z.array(eventResponseSchema),
  tasks: z.array(taskResponseSchema),
  expenses: z.array(expenseResponseSchema),
  reminders: z.array(reminderResponseSchema),
  documents: z.array(documentResponseSchema),
  lockedRelationCount: z.number().int().nonnegative(),
});

export const eventResourceProjectionResponseSchema = z.object({
  sourceEventId: objectIdSchema,
  items: z.array(eventResponseSchema),
});

export const taskResourceProjectionResponseSchema = z.object({
  sourceEventId: objectIdSchema,
  items: z.array(taskResponseSchema),
});

export const expenseResourceProjectionResponseSchema = z.object({
  sourceEventId: objectIdSchema,
  items: z.array(expenseResponseSchema),
});

export const reminderResourceProjectionResponseSchema = z.object({
  sourceEventId: objectIdSchema,
  items: z.array(reminderResponseSchema),
});

export const timelineResponseSchema = z.object({
  sourceEventId: objectIdSchema,
  items: z.array(
    z.object({
      canonicalObjectId: objectIdSchema,
      objectType: z.enum(["event", "task", "expense", "reminder"]),
      displayName: z.string(),
      occursAt: dateTimeResponseSchema,
      version: z.number().int().positive(),
    }),
  ),
});

export type EventCreateRequest = z.infer<typeof eventCreateRequestSchema>;
export type EventCreatePayload = z.input<typeof eventCreateRequestSchema>;
export type EventUpdateRequest = z.infer<typeof eventUpdateRequestSchema>;
export type EventUpdatePayload = z.input<typeof eventUpdateRequestSchema>;
export type TaskCreateRequest = z.infer<typeof taskCreateRequestSchema>;
export type TaskCreatePayload = z.input<typeof taskCreateRequestSchema>;
export type TaskUpdateRequest = z.infer<typeof taskUpdateRequestSchema>;
export type TaskUpdatePayload = z.input<typeof taskUpdateRequestSchema>;
export type ExpenseCreateRequest = z.infer<typeof expenseCreateRequestSchema>;
export type ExpenseCreatePayload = z.input<typeof expenseCreateRequestSchema>;
export type ExpenseUpdateRequest = z.infer<typeof expenseUpdateRequestSchema>;
export type ExpenseUpdatePayload = z.input<typeof expenseUpdateRequestSchema>;
export type ReminderCreateRequest = z.infer<typeof reminderCreateRequestSchema>;
export type ReminderCreatePayload = z.input<typeof reminderCreateRequestSchema>;
export type ReminderUpdateRequest = z.infer<typeof reminderUpdateRequestSchema>;
export type ReminderUpdatePayload = z.input<typeof reminderUpdateRequestSchema>;
export type RelationCreateRequest = z.infer<typeof relationCreateRequestSchema>;
export type RelationCreatePayload = z.input<typeof relationCreateRequestSchema>;
export type EventPlanningResourceResponse = z.infer<
  typeof eventPlanningResourceResponseSchema
>;
export type EventResponse = z.infer<typeof eventResponseSchema>;
export type EventListResponse = z.infer<typeof eventListResponseSchema>;
export type TaskResponse = z.infer<typeof taskResponseSchema>;
export type ExpenseResponse = z.infer<typeof expenseResponseSchema>;
export type ReminderResponse = z.infer<typeof reminderResponseSchema>;
export type DocumentResponse = z.infer<typeof documentResponseSchema>;
export type EventResourceProjectionResponse = z.infer<
  typeof eventResourceProjectionResponseSchema
>;
export type TaskResourceProjectionResponse = z.infer<
  typeof taskResourceProjectionResponseSchema
>;
export type ExpenseResourceProjectionResponse = z.infer<
  typeof expenseResourceProjectionResponseSchema
>;
export type ReminderResourceProjectionResponse = z.infer<
  typeof reminderResourceProjectionResponseSchema
>;
export type EventDetailResponse = z.infer<typeof eventDetailResponseSchema>;
export type TimelineResponse = z.infer<typeof timelineResponseSchema>;
