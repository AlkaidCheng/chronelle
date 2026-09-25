import type {
  ObjectType,
  PersonContactKind,
  RelationType,
  ReminderStatus,
  SectionView,
  TaskRepeatRule,
  TaskStatus,
} from "@livtales/db";
import type { UserPrincipal } from "@livtales/authorization";

export type JsonObject = Record<string, unknown>;

export interface MutationContext {
  readonly principal: UserPrincipal;
  readonly requestId: string;
  readonly command?: {
    readonly id: string;
    readonly operationId: string;
    readonly direction: "execute" | "undo" | "redo";
  };
}

export interface CanonicalObjectResource {
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly customProperties: JsonObject;
  readonly deletedAt: Date | null;
  readonly displayName: string;
  readonly id: string;
  readonly metadata: JsonObject;
  readonly objectType: ObjectType;
  readonly permissionScopeId: string;
  readonly updatedAt: Date;
  readonly version: number;
  readonly workspaceId: string;
}

export interface EventResource extends CanonicalObjectResource {
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly endsAt: Date | null;
  readonly isAllDay: boolean;
  /** Where the event happens, as text. */
  readonly location: string | null;
  /** Plain text about the event, line breaks kept. */
  readonly description: string | null;
  readonly objectType: "event";
  readonly startsAt: Date | null;
  readonly timezone: string | null;
}

export interface TaskResource extends CanonicalObjectResource {
  readonly completedAt: Date | null;
  /** A calendar date the task is due on; never set together with dueAt. */
  readonly dueOn: string | null;
  readonly dueAt: Date | null;
  /** How long the task takes, in minutes, only with a due instant. */
  readonly durationMinutes: number | null;
  /** How the task repeats from its due, if it does. */
  readonly repeatRule: TaskRepeatRule | null;
  /** The last date the task repeats to, if the rule ends. */
  readonly repeatUntil: string | null;
  readonly objectType: "task";
  /** The task this one is a subtask of; one level deep, same permission scope. */
  readonly parentTaskId: string | null;
  /** The Person responsible for the task. */
  readonly assigneeId: string | null;
  /** Where the task happens, as text. */
  readonly location: string | null;
  /** Plain text about the task, line breaks kept. */
  readonly description: string | null;
  /** The task's place in manual order. */
  readonly rank: string;
  /** The section of its Event's To-dos the task sits in, if any. */
  readonly sectionId: string | null;
  /** The task's labels in name order. */
  readonly labelIds: readonly string[];
  readonly status: TaskStatus;
}

export interface ExpenseResource extends CanonicalObjectResource {
  readonly amount: string;
  readonly currency: string;
  readonly objectType: "expense";
  readonly occurredAt: Date;
  /** The section of its Event's Expenses the expense sits in, if any. */
  readonly sectionId: string | null;
}

export interface ReminderResource extends CanonicalObjectResource {
  readonly objectType: "reminder";
  readonly remindAt: Date;
  readonly status: ReminderStatus;
  /** The reminder's place in manual order. */
  readonly rank: string;
}

/**
 * A named group in one view of an Event: a vocabulary of the Event, not a
 * canonical object, so it has no version, no Trash, and no history.
 */
export interface SectionResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly eventId: string;
  readonly view: SectionView;
  readonly name: string;
  readonly description: string | null;
  /** The section's place among its siblings. */
  readonly rank: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DocumentResource extends CanonicalObjectResource {
  readonly checksumSha256: string;
  readonly encryptionMode: string;
  readonly mimeType: string;
  readonly objectType: "document";
  readonly originalFilename: string;
  readonly sizeBytes: bigint;
  readonly storageKey: string;
  readonly storageProvider: string;
}

/** One way to reach a person: an email, a phone number, or anything else. */
export interface PersonContact {
  readonly kind: PersonContactKind;
  readonly value: string;
}

export interface PersonResource extends CanonicalObjectResource {
  readonly objectType: "person";
  /** The workspace member this person is, when they have an account. */
  readonly userId: string | null;
  /** The name shown in place of the display name when present. */
  readonly nickname: string | null;
  readonly description: string | null;
  /** The contacts in kept order. */
  readonly contacts: readonly PersonContact[];
  /** The person's labels in name order. */
  readonly labelIds: readonly string[];
}

/** Free text kept with an Event: the title is the display name, the body plain text with its line breaks. */
export interface NoteResource extends CanonicalObjectResource {
  readonly objectType: "note";
  readonly body: string;
}

export interface DocumentAttachmentResource {
  readonly relationVersion: number;
  readonly document: DocumentResource;
  readonly relationId: string;
}

export interface DocumentAttachmentList {
  readonly items: readonly DocumentAttachmentResource[];
  readonly lockedAttachmentCount: number;
}

export interface DocumentUploadAuthorizationInput {
  readonly checksumSha256: string;
  readonly mimeType: string;
  readonly originalFilename: string;
  readonly parentObjectId: string;
  readonly sizeBytes: number;
}

export interface DocumentUploadAuthorizationResource {
  readonly id: string;
  readonly upload: {
    readonly expiresAt: Date;
    readonly headers: Readonly<Record<string, string>>;
    readonly method: "PUT" | "POST";
    readonly url: string;
  };
}

export interface DocumentDownloadAuthorizationResource {
  readonly download: {
    readonly expiresAt: Date;
    readonly headers: Readonly<Record<string, string>>;
    readonly method: "GET";
    readonly url: string;
  };
}

export interface DocumentDownloadResource {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly originalFilename: string;
}

export type EventPlanningResource =
  | EventResource
  | TaskResource
  | ExpenseResource
  | ReminderResource
  | DocumentResource
  | PersonResource
  | NoteResource;

export interface CreateObjectFields {
  /** Binds the creation to one command of the caller; a repeat returns the created object. */
  readonly commandId?: string | undefined;
  readonly customProperties?: JsonObject | undefined;
  readonly displayName: string;
  readonly metadata?: JsonObject | undefined;
  readonly permissionScopeId?: string | undefined;
}

export interface CreateEventInput extends CreateObjectFields {
  readonly startsOn?: string | null | undefined;
  readonly endsOn?: string | null | undefined;
  readonly endsAt?: Date | null | undefined;
  readonly isAllDay?: boolean | undefined;
  readonly location?: string | null | undefined;
  readonly description?: string | null | undefined;
  readonly startsAt?: Date | null | undefined;
  readonly timezone?: string | null | undefined;
}

export interface CreateTaskInput extends CreateObjectFields {
  readonly completedAt?: Date | null | undefined;
  readonly dueOn?: string | null | undefined;
  readonly dueAt?: Date | null | undefined;
  readonly durationMinutes?: number | null | undefined;
  readonly repeatRule?: TaskRepeatRule | null | undefined;
  readonly repeatUntil?: string | null | undefined;
  readonly parentTaskId?: string | null | undefined;
  readonly assigneeId?: string | null | undefined;
  readonly location?: string | null | undefined;
  readonly description?: string | null | undefined;
  /** The task's place in manual order; absent puts it last. */
  readonly rank?: string | undefined;
  /** A section of the To-dos of the Event the task is created in. */
  readonly sectionId?: string | null | undefined;
  /** The task's labels as a whole; absent leaves them empty. */
  readonly labelIds?: readonly string[] | undefined;
  readonly status?: TaskStatus | undefined;
}

export interface CreateExpenseInput extends CreateObjectFields {
  readonly amount: string;
  readonly currency: string;
  readonly occurredAt: Date;
  /** A section of the Expenses of the Event the expense is created in. */
  readonly sectionId?: string | null | undefined;
}

export interface CreateReminderInput extends CreateObjectFields {
  readonly remindAt: Date;
  readonly status?: ReminderStatus | undefined;
  /** The reminder's place in manual order; absent puts it last. */
  readonly rank?: string | undefined;
}

export interface CreatePersonInput extends CreateObjectFields {
  readonly userId?: string | null | undefined;
  readonly nickname?: string | null | undefined;
  readonly description?: string | null | undefined;
  /** The contacts as a whole; absent leaves them empty. */
  readonly contacts?: readonly PersonContact[] | undefined;
  /** The person's labels as a whole; absent leaves them empty. */
  readonly labelIds?: readonly string[] | undefined;
}

export interface CreateNoteInput extends CreateObjectFields {
  /** The text; absent leaves it empty. */
  readonly body?: string | undefined;
}

export interface UpdateObjectFields {
  readonly customProperties?: JsonObject | undefined;
  readonly displayName?: string | undefined;
  readonly expectedVersion: number;
  readonly metadata?: JsonObject | undefined;
}

export interface UpdatePermissionScopeInput {
  readonly expectedVersion: number;
  readonly permissionScopeId: string;
}

export interface UpdateEventInput extends UpdateObjectFields {
  readonly startsOn?: string | null | undefined;
  readonly endsOn?: string | null | undefined;
  readonly endsAt?: Date | null | undefined;
  readonly isAllDay?: boolean | undefined;
  readonly location?: string | null | undefined;
  readonly description?: string | null | undefined;
  readonly startsAt?: Date | null | undefined;
  readonly timezone?: string | null | undefined;
}

export interface UpdateTaskInput extends UpdateObjectFields {
  readonly completedAt?: Date | null | undefined;
  readonly dueOn?: string | null | undefined;
  readonly dueAt?: Date | null | undefined;
  readonly durationMinutes?: number | null | undefined;
  readonly repeatRule?: TaskRepeatRule | null | undefined;
  readonly repeatUntil?: string | null | undefined;
  readonly parentTaskId?: string | null | undefined;
  readonly assigneeId?: string | null | undefined;
  readonly location?: string | null | undefined;
  readonly description?: string | null | undefined;
  readonly rank?: string | undefined;
  readonly sectionId?: string | null | undefined;
  /** The task's labels as a whole; absent leaves them unchanged. */
  readonly labelIds?: readonly string[] | undefined;
  readonly status?: TaskStatus | undefined;
}

export interface UpdateExpenseInput extends UpdateObjectFields {
  readonly amount?: string | undefined;
  readonly currency?: string | undefined;
  readonly occurredAt?: Date | undefined;
  readonly sectionId?: string | null | undefined;
}

export interface UpdateReminderInput extends UpdateObjectFields {
  readonly remindAt?: Date | undefined;
  readonly status?: ReminderStatus | undefined;
  readonly rank?: string | undefined;
}

export interface UpdatePersonInput extends UpdateObjectFields {
  readonly userId?: string | null | undefined;
  readonly nickname?: string | null | undefined;
  readonly description?: string | null | undefined;
  /** The contacts as a whole; absent leaves them unchanged. */
  readonly contacts?: readonly PersonContact[] | undefined;
  /** The person's labels as a whole; absent leaves them unchanged. */
  readonly labelIds?: readonly string[] | undefined;
}

export interface UpdateNoteInput extends UpdateObjectFields {
  readonly body?: string | undefined;
}

export interface ObjectDeletionResource {
  readonly deletedAt: Date;
  readonly id: string;
  readonly version: number;
}

export interface ObjectRelationResource {
  readonly version: number;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly deletedAt: Date | null;
  readonly id: string;
  readonly metadata: JsonObject;
  readonly relationType: RelationType;
  readonly sourceObjectId: string;
  readonly targetObjectId: string;
  readonly workspaceId: string;
}

export interface CreateObjectRelationInput {
  readonly metadata?: JsonObject | undefined;
  readonly relationType: RelationType;
  readonly sourceObjectId: string;
  readonly targetObjectId: string;
}

export interface RelationDeletionResource {
  readonly version: number;
  readonly deletedAt: Date;
  readonly id: string;
}

export interface ObjectSearchInput {
  readonly cursor?: string | undefined;
  readonly limit: number;
  readonly objectType?: ObjectType | undefined;
  readonly query: string;
}

export interface ObjectSearchPage {
  readonly items: readonly ObjectSearchResultResource[];
  readonly nextCursor: string | null;
}

export interface ObjectSearchResultResource {
  readonly displayName: string;
  readonly id: string;
  readonly objectType: ObjectType;
  readonly permissionScopeId: string;
  readonly updatedAt: Date;
  readonly version: number;
}

export interface EventDetailProjection {
  readonly documents: readonly DocumentResource[];
  readonly event: EventResource;
  readonly events: readonly EventResource[];
  readonly expenses: readonly ExpenseResource[];
  readonly persons: readonly PersonResource[];
  readonly reminders: readonly ReminderResource[];
  readonly tasks: readonly TaskResource[];
  readonly lockedRelationCount: number;
}

export interface EventResourceProjection {
  readonly items: readonly EventResource[];
  readonly sourceEventId: string;
}

export interface TaskResourceProjection {
  readonly items: readonly TaskResource[];
  /** The sections of the Event's To-dos in their order. */
  readonly sections: readonly SectionResource[];
  readonly sourceEventId: string;
}

export interface ExpenseResourceProjection {
  readonly items: readonly ExpenseResource[];
  /** The sections of the Event's Expenses in their order. */
  readonly sections: readonly SectionResource[];
  readonly sourceEventId: string;
}

export interface ReminderResourceProjection {
  readonly items: readonly ReminderResource[];
  readonly sourceEventId: string;
}

export interface PersonResourceProjection {
  readonly items: readonly PersonResource[];
  readonly sourceEventId: string;
}

export interface TimelineItem {
  readonly canonicalObjectId: string;
  readonly displayName: string;
  readonly objectType: "event" | "task" | "expense" | "reminder";
  readonly occursAt: Date | null;
  readonly occursOn?: string | null;
  readonly version: number;
}

export interface TimelineProjection {
  readonly items: readonly TimelineItem[];
  readonly sourceEventId: string;
}
