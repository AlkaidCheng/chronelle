import type { EventResource, MutationContext } from "./types.js";
import type { CreateEventInput, UpdateEventInput } from "./types.js";

/**
 * Write boundary for canonical Events.
 *
 * Implementations own the transaction strategy; callers depend only on the
 * authorization, version, audit, and revision contract. The PostgreSQL
 * implementation is EventPlanningObjectService's own transactional code.
 */
export interface EventWriteRepository {
  createEvent(
    context: MutationContext,
    input: CreateEventInput,
  ): Promise<EventResource>;
  updateEvent(
    context: MutationContext,
    objectId: string,
    input: UpdateEventInput,
  ): Promise<EventResource>;
}
