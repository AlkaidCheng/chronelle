import type {
  EventContextCreateRequest,
  EventContextCreateResponse,
} from "@chronelle/schemas";

import type {
  CreateEventInput,
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

/** Families with a write repository; absent families use the PostgreSQL path. */
export interface ObjectWriteRepositories {
  readonly event?: EventWriteRepository | undefined;
  readonly task?: TaskWriteRepository | undefined;
  readonly expense?: ExpenseWriteRepository | undefined;
  readonly reminder?: ReminderWriteRepository | undefined;
  readonly eventContext?: EventContextWriteRepository | undefined;
}
