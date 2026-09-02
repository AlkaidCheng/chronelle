import { AuthorizationDeniedError } from "@chronelle/authorization";
import type { UserPrincipal } from "@chronelle/authorization";
import { objectRelations, type Database } from "@chronelle/db";
import { and, eq, isNull } from "drizzle-orm";

import type { EventPlanningObjectService } from "./object-service.js";
import type {
  EventDetailProjection,
  EventPlanningResource,
  EventResource,
  EventResourceProjection,
  ExpenseResource,
  ExpenseResourceProjection,
  ReminderResource,
  ReminderResourceProjection,
  TaskResource,
  TaskResourceProjection,
  TimelineItem,
  TimelineProjection,
} from "./types.js";

function compareDates(
  first: Date | null,
  second: Date | null,
  firstId: string,
  secondId: string,
): number {
  if (first === null && second === null) {
    return firstId.localeCompare(secondId);
  }
  if (first === null) {
    return 1;
  }
  if (second === null) {
    return -1;
  }
  return first.getTime() - second.getTime() || firstId.localeCompare(secondId);
}

function isResource<Type extends EventPlanningResource["objectType"]>(
  resource: EventPlanningResource,
  objectType: Type,
): resource is Extract<EventPlanningResource, { objectType: Type }> {
  return resource.objectType === objectType;
}

export class EventPlanningProjectionService {
  readonly #database: Database;
  readonly #objects: EventPlanningObjectService;

  constructor(database: Database, objectsService: EventPlanningObjectService) {
    this.#database = database;
    this.#objects = objectsService;
  }

  async getDetail(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<EventDetailProjection> {
    const event = await this.#objects.getEvent(principal, eventId);
    const included = await this.#getIncludedResources(principal, eventId);

    return {
      event,
      events: included.filter((resource) => isResource(resource, "event")),
      tasks: included.filter((resource) => isResource(resource, "task")),
      expenses: included.filter((resource) => isResource(resource, "expense")),
      reminders: included.filter((resource) =>
        isResource(resource, "reminder"),
      ),
      documents: included.filter((resource) =>
        isResource(resource, "document"),
      ),
    };
  }

  async getTodos(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<TaskResourceProjection> {
    const detail = await this.getDetail(principal, eventId);
    const items = [...detail.tasks].sort((first, second) =>
      compareDates(first.dueAt, second.dueAt, first.id, second.id),
    );
    return { sourceEventId: eventId, items };
  }

  async getCalendar(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<EventResourceProjection> {
    const detail = await this.getDetail(principal, eventId);
    return {
      sourceEventId: eventId,
      items: this.#scheduledEvents(detail.events),
    };
  }

  async getItinerary(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<EventResourceProjection> {
    const detail = await this.getDetail(principal, eventId);
    return {
      sourceEventId: eventId,
      items: this.#scheduledEvents(detail.events),
    };
  }

  async getExpenses(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<ExpenseResourceProjection> {
    const detail = await this.getDetail(principal, eventId);
    const items = [...detail.expenses].sort((first, second) =>
      compareDates(second.occurredAt, first.occurredAt, second.id, first.id),
    );
    return { sourceEventId: eventId, items };
  }

  async getReminders(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<ReminderResourceProjection> {
    const detail = await this.getDetail(principal, eventId);
    const items = [...detail.reminders].sort((first, second) =>
      compareDates(first.remindAt, second.remindAt, first.id, second.id),
    );
    return { sourceEventId: eventId, items };
  }

  async getTimeline(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<TimelineProjection> {
    const detail = await this.getDetail(principal, eventId);
    const items: TimelineItem[] = [
      ...this.#timelineEvents(detail.events),
      ...this.#timelineTasks(detail.tasks),
      ...this.#timelineExpenses(detail.expenses),
      ...this.#timelineReminders(detail.reminders),
    ];
    items.sort((first, second) =>
      compareDates(
        first.occursAt,
        second.occursAt,
        first.canonicalObjectId,
        second.canonicalObjectId,
      ),
    );
    return { sourceEventId: eventId, items };
  }

  #scheduledEvents(events: readonly EventResource[]): EventResource[] {
    return events
      .filter(
        (event): event is EventResource & { startsAt: Date } =>
          event.startsAt !== null,
      )
      .sort((first, second) =>
        compareDates(first.startsAt, second.startsAt, first.id, second.id),
      );
  }

  #timelineEvents(events: readonly EventResource[]): TimelineItem[] {
    return events.flatMap((event) =>
      event.startsAt === null
        ? []
        : [
            {
              canonicalObjectId: event.id,
              objectType: "event" as const,
              displayName: event.displayName,
              occursAt: event.startsAt,
              version: event.version,
            },
          ],
    );
  }

  #timelineTasks(tasks: readonly TaskResource[]): TimelineItem[] {
    return tasks.flatMap((task) =>
      task.dueAt === null
        ? []
        : [
            {
              canonicalObjectId: task.id,
              objectType: "task" as const,
              displayName: task.displayName,
              occursAt: task.dueAt,
              version: task.version,
            },
          ],
    );
  }

  #timelineExpenses(expenses: readonly ExpenseResource[]): TimelineItem[] {
    return expenses.map((expense) => ({
      canonicalObjectId: expense.id,
      objectType: "expense",
      displayName: expense.displayName,
      occursAt: expense.occurredAt,
      version: expense.version,
    }));
  }

  #timelineReminders(reminders: readonly ReminderResource[]): TimelineItem[] {
    return reminders.map((reminder) => ({
      canonicalObjectId: reminder.id,
      objectType: "reminder",
      displayName: reminder.displayName,
      occursAt: reminder.remindAt,
      version: reminder.version,
    }));
  }

  async #getIncludedResources(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<EventPlanningResource[]> {
    const relations = await this.#database
      .select({ targetObjectId: objectRelations.targetObjectId })
      .from(objectRelations)
      .where(
        and(
          eq(objectRelations.workspaceId, principal.workspaceId),
          eq(objectRelations.sourceObjectId, eventId),
          eq(objectRelations.relationType, "includes"),
          isNull(objectRelations.deletedAt),
        ),
      );

    const resources = await Promise.all(
      relations.map(async ({ targetObjectId }) => {
        try {
          return await this.#objects.getObject(principal, targetObjectId);
        } catch (error) {
          if (error instanceof AuthorizationDeniedError) {
            return null;
          }
          throw error;
        }
      }),
    );
    return resources.filter(
      (resource): resource is EventPlanningResource => resource !== null,
    );
  }
}
