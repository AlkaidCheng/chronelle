import type { ShareWriteRepository } from "@livtales/authorization";
import type {
  CommandExecuteRequest,
  CommandReceipt,
  CommandTransitionRequest,
  EventContextCreateRequest,
  EventContextCreateResponse,
  EventLayoutResponse,
  EventPage,
} from "@livtales/schemas";

import type {
  CreateEventInput,
  CreateObjectRelationInput,
  EventPlanningResource,
  ObjectDeletionResource,
  ObjectRelationResource,
  CreateExpenseInput,
  CreateNoteInput,
  CreatePersonInput,
  CreateReminderInput,
  CreateTaskInput,
  EventResource,
  ExpenseResource,
  MutationContext,
  NoteResource,
  PersonResource,
  ReminderResource,
  TaskResource,
  UpdateEventInput,
  UpdateExpenseInput,
  UpdateNoteInput,
  UpdatePersonInput,
  UpdateReminderInput,
  UpdateTaskInput,
} from "./types.js";

/**
 * Write boundary for one canonical object family.
 *
 * Implementations own the transaction strategy; callers depend only on the
 * authorization, version, audit, and revision contract. The PostgreSQL
 * implementation of every family is EventPlanningObjectService's own
 * transactional code, used whenever no repository is injected.
 */
export interface ObjectWriteRepository<CreateInput, UpdateInput, Resource> {
  create(context: MutationContext, input: CreateInput): Promise<Resource>;
  update(
    context: MutationContext,
    objectId: string,
    input: UpdateInput,
  ): Promise<Resource>;
}

export type EventWriteRepository = ObjectWriteRepository<
  CreateEventInput,
  UpdateEventInput,
  EventResource
>;

export type TaskWriteRepository = ObjectWriteRepository<
  CreateTaskInput,
  UpdateTaskInput,
  TaskResource
>;

export type ExpenseWriteRepository = ObjectWriteRepository<
  CreateExpenseInput,
  UpdateExpenseInput,
  ExpenseResource
>;

export type ReminderWriteRepository = ObjectWriteRepository<
  CreateReminderInput,
  UpdateReminderInput,
  ReminderResource
>;
export type PersonWriteRepository = ObjectWriteRepository<
  CreatePersonInput,
  UpdatePersonInput,
  PersonResource
>;
export type NoteWriteRepository = ObjectWriteRepository<
  CreateNoteInput,
  UpdateNoteInput,
  NoteResource
>;

/**
 * Linked creation: one typed resource included in a self-scoped Event, once
 * per user, workspace, and command. Implementations own the transaction that
 * spans the object, the relation, both audit rows, and the command record.
 */
export interface EventContextWriteRepository {
  create(
    context: MutationContext,
    eventId: string,
    input: EventContextCreateRequest,
  ): Promise<EventContextCreateResponse>;
}

/**
 * Relation writes: creation with the service's compatibility and
 * authorization rules, and removal and recovery under a version predicate,
 * each with its audit row.
 */
export interface RelationWriteRepository {
  create(
    context: MutationContext,
    input: CreateObjectRelationInput,
  ): Promise<ObjectRelationResource>;
  remove(
    context: MutationContext,
    relationId: string,
    expectedVersion: number,
    deletedAt: Date,
  ): Promise<ObjectRelationResource>;
  recover(
    context: MutationContext,
    relationId: string,
    expectedVersion: number,
  ): Promise<ObjectRelationResource>;
}

/** The content of a historical revision selected for restoration, in serialized form. */
export interface RevisionRestoreSource {
  readonly revisionId: string;
  readonly version: number;
  readonly content: Record<string, unknown>;
}

/**
 * Object lifecycle: soft deletion under a version predicate, recovery from
 * Trash, and restoration of a revision's content, each with its audit event
 * and revision snapshot. The restoration policy selects the content; the
 * implementation applies it.
 */
export interface ObjectLifecycleWriteRepository {
  remove(
    context: MutationContext,
    objectId: string,
    expectedVersion: number,
    deletedAt: Date,
  ): Promise<ObjectDeletionResource>;
  recover(
    context: MutationContext,
    objectId: string,
    expectedVersion: number,
  ): Promise<EventPlanningResource>;
  restore(
    context: MutationContext,
    objectId: string,
    expectedVersion: number,
    source: RevisionRestoreSource,
  ): Promise<EventPlanningResource>;
}

/**
 * Permission-scope changes: moving an object to itself or to a self-scoped
 * Event under the version predicate, with the audit event and the revision.
 */
export interface PermissionScopeWriteRepository {
  updatePermissionScope(
    context: MutationContext,
    objectId: string,
    expectedVersion: number,
    permissionScopeId: string,
    updatedAt: Date,
  ): Promise<EventPlanningResource>;
}

/**
 * Event page layout changes: a validated layout saved as the next version,
 * or an earlier version (0 for the empty layout) restored as the next
 * version, each under the version predicate with its audit event.
 */
export interface EventLayoutWriteRepository {
  update(
    context: MutationContext,
    eventId: string,
    expectedVersion: number,
    pages: readonly EventPage[],
  ): Promise<EventLayoutResponse>;
  restore(
    context: MutationContext,
    eventId: string,
    expectedVersion: number,
    targetVersion: number,
  ): Promise<EventLayoutResponse>;
}

/**
 * Reversible content commands: a command's Event and Task edits applied as
 * one unit, and the undo and redo transitions that restore each changed
 * object from the revision before or after the command. Each call records
 * the command, advances the caller's stack, and writes the receipt with its
 * audit event; a repeated operation returns its receipt.
 */
export interface CommandWriteRepository {
  execute(
    context: MutationContext,
    input: CommandExecuteRequest,
  ): Promise<CommandReceipt>;
  transition(
    context: MutationContext,
    input: CommandTransitionRequest,
    direction: "undo" | "redo",
  ): Promise<CommandReceipt>;
}

/** Families with a write repository; absent families use the PostgreSQL path. */
export interface ObjectWriteRepositories {
  readonly event?: EventWriteRepository | undefined;
  readonly task?: TaskWriteRepository | undefined;
  readonly expense?: ExpenseWriteRepository | undefined;
  readonly reminder?: ReminderWriteRepository | undefined;
  readonly person?: PersonWriteRepository | undefined;
  readonly note?: NoteWriteRepository | undefined;
  readonly eventContext?: EventContextWriteRepository | undefined;
  readonly relation?: RelationWriteRepository | undefined;
  readonly objectLifecycle?: ObjectLifecycleWriteRepository | undefined;
  readonly share?: ShareWriteRepository | undefined;
  readonly permissionScope?: PermissionScopeWriteRepository | undefined;
  readonly eventLayout?: EventLayoutWriteRepository | undefined;
  readonly command?: CommandWriteRepository | undefined;
}
