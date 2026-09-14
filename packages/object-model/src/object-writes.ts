import type {
  EventContextCreateRequest,
  EventContextCreateResponse,
} from "@chronelle/schemas";

import type {
  CreateEventInput,
  CreateObjectRelationInput,
  EventPlanningResource,
  ObjectDeletionResource,
  ObjectRelationResource,
  CreateExpenseInput,
  CreateReminderInput,
  CreateTaskInput,
  EventResource,
  ExpenseResource,
  MutationContext,
  ReminderResource,
  TaskResource,
  UpdateEventInput,
  UpdateExpenseInput,
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

/**
 * Object lifecycle: soft deletion under a version predicate and recovery
 * from Trash, each with its audit event and revision snapshot.
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
}

/** Families with a write repository; absent families use the PostgreSQL path. */
export interface ObjectWriteRepositories {
  readonly event?: EventWriteRepository | undefined;
  readonly task?: TaskWriteRepository | undefined;
  readonly expense?: ExpenseWriteRepository | undefined;
  readonly reminder?: ReminderWriteRepository | undefined;
  readonly eventContext?: EventContextWriteRepository | undefined;
  readonly relation?: RelationWriteRepository | undefined;
  readonly objectLifecycle?: ObjectLifecycleWriteRepository | undefined;
}
