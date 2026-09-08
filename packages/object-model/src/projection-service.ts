import { withReadAuthorization } from "@chronelle/authorization";
import type { UserPrincipal } from "@chronelle/authorization";
import {
  objectRelations,
  objects,
  type Database,
  type DatabaseTransaction,
} from "@chronelle/db";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { EventPlanningObjectService } from "./object-service.js";
import type {
  DocumentResource,
  EventDetailProjection,
  EventPlanningResource,
  EventResource,
  EventResourceProjection,
  ExpenseResourceProjection,
  ReminderResourceProjection,
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

type TimelineResource = Exclude<EventPlanningResource, DocumentResource>;
function timelineItem(resource: TimelineResource): TimelineItem[] {
  if (resource.objectType === "event" && resource.startsOn !== null)
    return [
      {
        canonicalObjectId: resource.id,
        objectType: "event",
        displayName: resource.displayName,
        occursAt: null,
        occursOn: resource.startsOn,
        version: resource.version,
      },
    ];
  let occursAt: Date | null;
  switch (resource.objectType) {
    case "event":
      occursAt = resource.startsAt;
      break;
    case "task":
      occursAt = resource.dueAt;
      break;
    case "expense":
      occursAt = resource.occurredAt;
      break;
    case "reminder":
      occursAt = resource.remindAt;
      break;
  }
  return occursAt === null
    ? []
    : [
        {
          canonicalObjectId: resource.id,
          objectType: resource.objectType,
          displayName: resource.displayName,
          occursAt,
          version: resource.version,
        },
      ];
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
    const resources = await this.#getProjectionResources(principal, eventId, [
      "task",
    ]);
    const items = resources.sort((first, second) =>
      compareDates(first.dueAt, second.dueAt, first.id, second.id),
    );
    return { sourceEventId: eventId, items };
  }

  async getCalendar(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<EventResourceProjection> {
    const resources = await this.#getProjectionResources(principal, eventId, [
      "event",
    ]);
    return {
      sourceEventId: eventId,
      items: this.#scheduledEvents(resources),
    };
  }

  async getItinerary(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<EventResourceProjection> {
    return this.getCalendar(principal, eventId);
  }

  async getExpenses(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<ExpenseResourceProjection> {
    const resources = await this.#getProjectionResources(principal, eventId, [
      "expense",
    ]);
    const items = resources.sort((first, second) =>
      compareDates(second.occurredAt, first.occurredAt, second.id, first.id),
    );
    return { sourceEventId: eventId, items };
  }

  async getReminders(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<ReminderResourceProjection> {
    const resources = await this.#getProjectionResources(principal, eventId, [
      "reminder",
    ]);
    const items = resources.sort((first, second) =>
      compareDates(first.remindAt, second.remindAt, first.id, second.id),
    );
    return { sourceEventId: eventId, items };
  }

  async getTimeline(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<TimelineProjection> {
    const resources = await this.#getProjectionResources(principal, eventId, [
      "event",
      "task",
      "expense",
      "reminder",
    ]);
    const items = resources.flatMap(timelineItem);
    items.sort((first, second) =>
      compareDates(
        first.occursOn
          ? new Date(`${first.occursOn}T00:00:00Z`)
          : first.occursAt,
        second.occursOn
          ? new Date(`${second.occursOn}T00:00:00Z`)
          : second.occursAt,
        first.canonicalObjectId,
        second.canonicalObjectId,
      ),
    );
    return { sourceEventId: eventId, items };
  }

  #scheduledEvents(events: readonly EventResource[]): EventResource[] {
    return events
      .filter((event) => event.startsAt !== null || event.startsOn !== null)
      .sort((first, second) =>
        compareDates(
          first.startsOn
            ? new Date(`${first.startsOn}T00:00:00Z`)
            : first.startsAt,
          second.startsOn
            ? new Date(`${second.startsOn}T00:00:00Z`)
            : second.startsAt,
          first.id,
          second.id,
        ),
      );
  }

  async #getProjectionResources<Type extends TimelineResource["objectType"]>(
    principal: UserPrincipal,
    eventId: string,
    objectTypes: readonly Type[],
  ): Promise<Extract<EventPlanningResource, { objectType: Type }>[]> {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        const reader = new EventPlanningObjectService({
          database: transaction,
          authorization,
        });
        await reader.getEvent(principal, eventId);
        const included = await this.#getIncludedResources(
          transaction,
          reader,
          principal,
          eventId,
          objectTypes,
        );
        return included.resources.filter(
          (
            resource,
          ): resource is Extract<EventPlanningResource, { objectType: Type }> =>
            objectTypes.some((type) => resource.objectType === type),
        );
      },
    );
  }

  async #getIncludedResources(
    transaction: DatabaseTransaction,
    reader: EventPlanningObjectService,
    principal: UserPrincipal,
    eventId: string,
    objectTypes?: readonly TimelineResource["objectType"][],
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
          objectTypes === undefined
            ? undefined
            : inArray(objects.objectType, [...objectTypes]),
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
    const resources = await reader.listVisibleObjects(principal, objectIds);
    return {
      resources,
      lockedRelationCount: objectIds.length - resources.length,
    };
  }
}
