import { z } from "zod";
import { calendarDateSchema } from "./event-calendar-dates.js";
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
  "person",
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
  startsOn: calendarDateSchema.nullable().optional(),
  endsOn: calendarDateSchema.nullable().optional(),
  startsAt: nullableDateTimeInputSchema.optional(),
  endsAt: nullableDateTimeInputSchema.optional(),
  timezone: z.string().trim().min(1).max(120).nullable().optional(),
  isAllDay: z.boolean().optional(),
});

export const eventUpdateRequestSchema = z
  .object({
    ...updateObjectShape,
    startsOn: calendarDateSchema.nullable().optional(),
    endsOn: calendarDateSchema.nullable().optional(),
    startsAt: nullableDateTimeInputSchema.optional(),
    endsAt: nullableDateTimeInputSchema.optional(),
    timezone: z.string().trim().min(1).max(120).nullable().optional(),
    isAllDay: z.boolean().optional(),
  })
  .refine(hasUpdateFields, {
    message: "At least one update field is required.",
  });

// A Task is due on a date (dueOn), at an instant (dueAt), or not at all;
// the service refuses a state with both.
// A Task may be a subtask of one other Task (parentTaskId), one level deep,
// sharing its parent's permission scope; the service enforces the rules.
// A Task may be assigned to one live Person of its workspace (assigneeId)
// and name where it happens as text (location).
const taskLocationSchema = z.string().trim().min(1).max(240).nullable();

export const taskCreateRequestSchema = z.object({
  ...createObjectShape,
  status: taskStatusSchema.optional(),
  dueOn: calendarDateSchema.nullable().optional(),
  dueAt: nullableDateTimeInputSchema.optional(),
  completedAt: nullableDateTimeInputSchema.optional(),
  parentTaskId: objectIdSchema.nullable().optional(),
  assigneeId: objectIdSchema.nullable().optional(),
  location: taskLocationSchema.optional(),
  /** The task's labels as a whole; absent leaves them unchanged. */
  labelIds: z.array(objectIdSchema).max(20).optional(),
});

export const taskUpdateRequestSchema = z
  .object({
    ...updateObjectShape,
    status: taskStatusSchema.optional(),
    dueOn: calendarDateSchema.nullable().optional(),
    dueAt: nullableDateTimeInputSchema.optional(),
    completedAt: nullableDateTimeInputSchema.optional(),
    parentTaskId: objectIdSchema.nullable().optional(),
    assigneeId: objectIdSchema.nullable().optional(),
    location: taskLocationSchema.optional(),
    labelIds: z.array(objectIdSchema).max(20).optional(),
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

/** A Person's email as stored: trimmed, or null. */
const personEmailSchema = z.string().trim().max(254).pipe(z.email()).nullable();

// A Person is someone the workspace keeps track of: a display name, an
// optional email, and an optional link to a workspace member's account
// (userId), which belongs to one Person per workspace.
export const personCreateRequestSchema = z.object({
  ...createObjectShape,
  email: personEmailSchema.optional(),
  userId: objectIdSchema.nullable().optional(),
});

export const personUpdateRequestSchema = z
  .object({
    ...updateObjectShape,
    email: personEmailSchema.optional(),
    userId: objectIdSchema.nullable().optional(),
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
  startsOn: calendarDateSchema.nullable().default(null),
  endsOn: calendarDateSchema.nullable().default(null),
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
  dueOn: calendarDateSchema.nullable().default(null),
  dueAt: nullableDateTimeResponseSchema,
  completedAt: nullableDateTimeResponseSchema,
  parentTaskId: objectIdSchema.nullable().default(null),
  /** The Person responsible for the task. */
  assigneeId: objectIdSchema.nullable().default(null),
  /** Where the task happens, as text. */
  location: z.string().nullable().default(null),
  /** The task's labels in name order. */
  labelIds: z.array(objectIdSchema).default([]),
});

/** The Event a listed Task belongs to, when the caller may view that Event. */
export const taskContextSchema = z.object({
  eventId: objectIdSchema,
  displayName: z.string(),
});

/** How many subtasks a listed parent has, and how many are done. */
export const taskProgressSchema = z.object({
  done: z.number().int().nonnegative(),
  total: z.number().int().positive(),
});

/** The parent of a listed subtask, when the caller may view it. */
export const taskParentSchema = z.object({
  taskId: objectIdSchema,
  displayName: z.string(),
});

export const taskListResponseSchema = z.object({
  items: z.array(taskResponseSchema),
  /** By Task ID; a Task outside any viewable Event has no entry. */
  contexts: z.record(objectIdSchema, taskContextSchema),
  /** By parent Task ID, for listed parents with live subtasks. */
  progress: z.record(objectIdSchema, taskProgressSchema),
  /** By subtask ID, for listed subtasks whose parent the caller may view. */
  parents: z.record(objectIdSchema, taskParentSchema),
  nextCursor: cursorTokenSchema.nullable(),
  asOf: dateTimeResponseSchema,
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

export const personResponseSchema = z.object({
  ...canonicalObjectResponseShape,
  objectType: z.literal("person"),
  email: z.string().nullable(),
  /** The workspace member this person is, when they have an account. */
  userId: objectIdSchema.nullable(),
});

export const eventPlanningResourceResponseSchema = z.discriminatedUnion(
  "objectType",
  [
    eventResponseSchema,
    taskResponseSchema,
    expenseResponseSchema,
    reminderResponseSchema,
    documentResponseSchema,
    personResponseSchema,
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
  persons: z.array(personResponseSchema).default([]),
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

export const personResourceProjectionResponseSchema = z.object({
  sourceEventId: objectIdSchema,
  items: z.array(personResponseSchema),
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
      occursAt: dateTimeResponseSchema.nullable(),
      occursOn: calendarDateSchema.nullable().default(null),
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
export type PersonCreateRequest = z.infer<typeof personCreateRequestSchema>;
export type PersonCreatePayload = z.input<typeof personCreateRequestSchema>;
export type PersonUpdateRequest = z.infer<typeof personUpdateRequestSchema>;
export type PersonUpdatePayload = z.input<typeof personUpdateRequestSchema>;
export type RelationCreateRequest = z.infer<typeof relationCreateRequestSchema>;
export type RelationCreatePayload = z.input<typeof relationCreateRequestSchema>;
export type EventPlanningResourceResponse = z.infer<
  typeof eventPlanningResourceResponseSchema
>;
export type EventResponse = z.infer<typeof eventResponseSchema>;
export type EventListResponse = z.infer<typeof eventListResponseSchema>;
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;
export type TaskContext = z.infer<typeof taskContextSchema>;
export type TaskProgress = z.infer<typeof taskProgressSchema>;
export type TaskParent = z.infer<typeof taskParentSchema>;
export type TaskResponse = z.infer<typeof taskResponseSchema>;
export type ExpenseResponse = z.infer<typeof expenseResponseSchema>;
export type ReminderResponse = z.infer<typeof reminderResponseSchema>;
export type DocumentResponse = z.infer<typeof documentResponseSchema>;
export type PersonResponse = z.infer<typeof personResponseSchema>;
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
export type PersonResourceProjectionResponse = z.infer<
  typeof personResourceProjectionResponseSchema
>;
export type EventDetailResponse = z.infer<typeof eventDetailResponseSchema>;
export type TimelineResponse = z.infer<typeof timelineResponseSchema>;
