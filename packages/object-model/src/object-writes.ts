import type {
  CreateEventInput,
  CreateTaskInput,
  EventResource,
  MutationContext,
  TaskResource,
  UpdateEventInput,
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

/** Families with a write repository; absent families use the PostgreSQL path. */
export interface ObjectWriteRepositories {
  readonly event?: EventWriteRepository | undefined;
  readonly task?: TaskWriteRepository | undefined;
}
