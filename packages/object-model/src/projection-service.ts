import {
  AuthorizationDeniedError,
  withReadAuthorization,
} from "@chronelle/authorization";
import type { UserPrincipal } from "@chronelle/authorization";
import {
  objectRelations,
  objects,
  type Database,
  type DatabaseTransaction,
} from "@chronelle/db";
import { and, eq, isNull } from "drizzle-orm";

import { EventPlanningObjectService } from "./object-service.js";
import type {
  DocumentResource,
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

  constructor(database: Database) {
    this.#database = database;
  }

  async getDetail(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<EventDetailProjection> {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        const reader = new EventPlanningObjectService({
          database: transaction,
          authorization,
        });
        const event = await reader.getEvent(principal, eventId);
        const [included, attached] = await Promise.all([
          this.#getIncludedResources(transaction, reader, principal, eventId),
          this.#getAttachedDocuments(transaction, reader, principal, eventId),
        ]);
        const documents = new Map(
          [
            ...included.resources.filter((resource) =>
              isResource(resource, "document"),
            ),
            ...attached.resources,
          ].map((document) => [document.id, document]),
        );

        return {
          event,
          events: included.resources.filter((resource) =>
            isResource(resource, "event"),
          ),
          tasks: included.resources.filter((resource) =>
            isResource(resource, "task"),
          ),
          expenses: included.resources.filter((resource) =>
            isResource(resource, "expense"),
          ),
          reminders: included.resources.filter((resource) =>
            isResource(resource, "reminder"),
          ),
          documents: [...documents.values()],
          lockedRelationCount:
            included.lockedRelationCount + attached.lockedRelationCount,
        };
      },
    );
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
    transaction: DatabaseTransaction,
    reader: EventPlanningObjectService,
    principal: UserPrincipal,
    eventId: string,
  ): Promise<{
    readonly lockedRelationCount: number;
    readonly resources: EventPlanningResource[];
  }> {
    const relations = await transaction
      .select({ targetObjectId: objectRelations.targetObjectId })
      .from(objectRelations)
      .innerJoin(
        objects,
        and(
          eq(objects.workspaceId, objectRelations.workspaceId),
          eq(objects.id, objectRelations.targetObjectId),
          isNull(objects.deletedAt),
        ),
      )
      .where(
        and(
          eq(objectRelations.workspaceId, principal.workspaceId),
          eq(objectRelations.sourceObjectId, eventId),
          eq(objectRelations.relationType, "includes"),
          isNull(objectRelations.deletedAt),
        ),
      );

    return this.#resolveVisibleResources(
      reader,
      principal,
      relations.map(({ targetObjectId }) => targetObjectId),
    );
  }

  async #getAttachedDocuments(
    transaction: DatabaseTransaction,
    reader: EventPlanningObjectService,
    principal: UserPrincipal,
    eventId: string,
  ): Promise<{
    readonly lockedRelationCount: number;
    readonly resources: DocumentResource[];
  }> {
    const relations = await transaction
      .select({ sourceObjectId: objectRelations.sourceObjectId })
      .from(objectRelations)
      .innerJoin(
        objects,
        and(
          eq(objects.workspaceId, objectRelations.workspaceId),
          eq(objects.id, objectRelations.sourceObjectId),
          eq(objects.objectType, "document"),
          isNull(objects.deletedAt),
        ),
      )
      .where(
        and(
          eq(objectRelations.workspaceId, principal.workspaceId),
          eq(objectRelations.targetObjectId, eventId),
          eq(objectRelations.relationType, "attached_to"),
          isNull(objectRelations.deletedAt),
        ),
      );
    const resolved = await this.#resolveVisibleResources(
      reader,
      principal,
      relations.map(({ sourceObjectId }) => sourceObjectId),
    );
    return {
      resources: resolved.resources.filter((resource) =>
        isResource(resource, "document"),
      ),
      lockedRelationCount: resolved.lockedRelationCount,
    };
  }

  async #resolveVisibleResources(
    reader: EventPlanningObjectService,
    principal: UserPrincipal,
    objectIds: readonly string[],
  ): Promise<{
    readonly lockedRelationCount: number;
    readonly resources: EventPlanningResource[];
  }> {
    const resources = await Promise.all(
      objectIds.map(async (objectId) => {
        try {
          return await reader.getObject(principal, objectId);
        } catch (error) {
          if (error instanceof AuthorizationDeniedError) {
            return null;
          }
          throw error;
        }
      }),
    );
    const visibleResources = resources.filter(
      (resource): resource is EventPlanningResource => resource !== null,
    );
    return {
      resources: visibleResources,
      lockedRelationCount: resources.length - visibleResources.length,
    };
  }
}
