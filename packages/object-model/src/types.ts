import type {
  ObjectType,
  RelationType,
  ReminderStatus,
  TaskStatus,
} from "@chronelle/db";
import type { UserPrincipal } from "@chronelle/authorization";

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
  readonly objectType: "event";
  readonly startsAt: Date | null;
  readonly timezone: string | null;
}

export interface TaskResource extends CanonicalObjectResource {
  readonly completedAt: Date | null;
  /** A calendar date the task is due on; never set together with dueAt. */
  readonly dueOn: string | null;
  readonly dueAt: Date | null;
  readonly objectType: "task";
  /** The task this one is a subtask of; one level deep, same permission scope. */
  readonly parentTaskId: string | null;
  /** The Person responsible for the task. */
  readonly assigneeId: string | null;
  /** The task's labels in name order. */
  readonly labelIds: readonly string[];
  readonly status: TaskStatus;
}

export interface ExpenseResource extends CanonicalObjectResource {
  readonly amount: string;
  readonly currency: string;
  readonly objectType: "expense";
  readonly occurredAt: Date;
}

export interface ReminderResource extends CanonicalObjectResource {
  readonly objectType: "reminder";
  readonly remindAt: Date;
  readonly status: ReminderStatus;
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

export interface PersonResource extends CanonicalObjectResource {
  readonly email: string | null;
  readonly objectType: "person";
  /** The workspace member this person is, when they have an account. */
  readonly userId: string | null;
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
    readonly method: "PUT";
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
  | PersonResource;

export interface CreateObjectFields {
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
  readonly startsAt?: Date | null | undefined;
  readonly timezone?: string | null | undefined;
}

export interface CreateTaskInput extends CreateObjectFields {
  readonly completedAt?: Date | null | undefined;
  readonly dueOn?: string | null | undefined;
  readonly dueAt?: Date | null | undefined;
  readonly parentTaskId?: string | null | undefined;
  readonly assigneeId?: string | null | undefined;
  /** The task's labels as a whole; absent leaves them empty. */
  readonly labelIds?: readonly string[] | undefined;
  readonly status?: TaskStatus | undefined;
}

export interface CreateExpenseInput extends CreateObjectFields {
  readonly amount: string;
  readonly currency: string;
  readonly occurredAt: Date;
}

export interface CreateReminderInput extends CreateObjectFields {
  readonly remindAt: Date;
  readonly status?: ReminderStatus | undefined;
}

export interface CreatePersonInput extends CreateObjectFields {
  readonly email?: string | null | undefined;
  readonly userId?: string | null | undefined;
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
  readonly startsAt?: Date | null | undefined;
  readonly timezone?: string | null | undefined;
}

export interface UpdateTaskInput extends UpdateObjectFields {
  readonly completedAt?: Date | null | undefined;
  readonly dueOn?: string | null | undefined;
  readonly dueAt?: Date | null | undefined;
  readonly parentTaskId?: string | null | undefined;
  readonly assigneeId?: string | null | undefined;
  /** The task's labels as a whole; absent leaves them unchanged. */
  readonly labelIds?: readonly string[] | undefined;
  readonly status?: TaskStatus | undefined;
}

export interface UpdateExpenseInput extends UpdateObjectFields {
  readonly amount?: string | undefined;
  readonly currency?: string | undefined;
  readonly occurredAt?: Date | undefined;
}

export interface UpdateReminderInput extends UpdateObjectFields {
  readonly remindAt?: Date | undefined;
  readonly status?: ReminderStatus | undefined;
}

export interface UpdatePersonInput extends UpdateObjectFields {
  readonly email?: string | null | undefined;
  readonly userId?: string | null | undefined;
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
  readonly sourceEventId: string;
}

export interface ExpenseResourceProjection {
  readonly items: readonly ExpenseResource[];
  readonly sourceEventId: string;
}

export interface ReminderResourceProjection {
  readonly items: readonly ReminderResource[];
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
