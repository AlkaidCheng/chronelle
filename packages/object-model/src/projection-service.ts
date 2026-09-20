import { withReadAuthorization } from "@chronelle/authorization";
import type { UserPrincipal } from "@chronelle/authorization";
import {
  objectRelations,
  objects,
  type Database,
  type DatabaseTransaction,
} from "@chronelle/db";
import type {
  EventAttachmentTargetsResponse,
  NoteListQueryInput,
} from "@chronelle/schemas";
import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  type NotePage,
  type NoteReadRepository,
  PostgresNoteReadRepository,
} from "./note-list.js";
import { EventPlanningObjectService } from "./object-service.js";
import { comparePersonNames } from "./person-list.js";
import {
  PostgresSectionRepository,
  type SectionReadRepository,
} from "./sections.js";
import type {
  DocumentResource,
  EventDetailProjection,
  EventPlanningResource,
  EventResource,
  EventResourceProjection,
  ExpenseResourceProjection,
  NoteResource,
  PersonResource,
  PersonResourceProjection,
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

function dueInstant(task: TaskResource): Date | null {
  return task.dueOn === null ? task.dueAt : new Date(`${task.dueOn}T00:00:00Z`);
}

function isResource<Type extends EventPlanningResource["objectType"]>(
  resource: EventPlanningResource,
  objectType: Type,
): resource is Extract<EventPlanningResource, { objectType: Type }> {
  return resource.objectType === objectType;
}

type TimelineResource = Exclude<
  EventPlanningResource,
  DocumentResource | PersonResource | NoteResource
>;

/** The typed object families a focused projection selects from an Event's `includes` relations. */
export type ProjectionObjectType =
  TimelineResource["objectType"] | PersonResource["objectType"];

export interface CalendarReadRepository {
  listCalendarEvents(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<readonly EventResource[]>;
}

export class PostgresCalendarReadRepository implements CalendarReadRepository {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  listCalendarEvents(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<readonly EventResource[]> {
    return readProjectionResources(this.#database, principal, eventId, [
      "event",
    ]);
  }
}

/**
 * The authorized rows behind an Event detail projection, read from one
 * snapshot. The projection service partitions them by type; the repository
 * only decides what the principal may see.
 */
export interface EventDetailReadResult {
  /** Visible Documents attached to the Event through `attached_to` relations. */
  readonly attachedDocuments: readonly DocumentResource[];
  readonly event: EventResource;
  /** Visible targets of the Event's active `includes` relations, in relation order. */
  readonly includedResources: readonly EventPlanningResource[];
  /** Active relations whose live target the principal may not view. */
  readonly lockedRelationCount: number;
}

export interface AttachmentTargetsReadResult {
  readonly event: Pick<EventResource, "id" | "displayName">;
  readonly included: readonly Pick<
    EventPlanningResource,
    "id" | "displayName" | "objectType"
  >[];
}

/**
 * Read boundary for the Event detail, to-do, timeline, itinerary, expense,
 * and reminder projections. Every method authorizes the root Event for view,
 * follows only active relations to live objects, and omits targets the
 * principal cannot view instead of leaking them. Ordering, filtering, and
 * shaping stay in the projection service so both backends share them.
 */
export interface ProjectionReadRepository {
  readAttachmentTargets(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<AttachmentTargetsReadResult>;
  listIncludedResources<Type extends ProjectionObjectType>(
    principal: UserPrincipal,
    eventId: string,
    objectTypes: readonly Type[],
  ): Promise<readonly Extract<EventPlanningResource, { objectType: Type }>[]>;
  readEventDetail(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<EventDetailReadResult>;
}

export class PostgresProjectionReadRepository implements ProjectionReadRepository {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  readAttachmentTargets(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<AttachmentTargetsReadResult> {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        const reader = new EventPlanningObjectService({
          database: transaction,
          authorization,
        });
        const event = await reader.getEvent(principal, eventId);
        const candidates = await transaction
          .select({
            id: objects.id,
            displayName: objects.displayName,
            objectType: objects.objectType,
          })
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
        const targets = candidates.filter(
          ({ objectType }) => objectType === "task" || objectType === "expense",
        );
        const allowed = await authorization.canMany(
          principal,
          "view",
          targets.map(({ id }) => ({ id, workspaceId: principal.workspaceId })),
        );
        return {
          event: { id: event.id, displayName: event.displayName },
          included: targets.filter((_, index) => allowed[index]),
        };
      },
    );
  }

  listIncludedResources<Type extends ProjectionObjectType>(
    principal: UserPrincipal,
    eventId: string,
    objectTypes: readonly Type[],
  ): Promise<readonly Extract<EventPlanningResource, { objectType: Type }>[]> {
    return readProjectionResources(
      this.#database,
      principal,
      eventId,
      objectTypes,
    );
  }

  async readEventDetail(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<EventDetailReadResult> {
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
        return {
          event,
          includedResources: included.resources,
          attachedDocuments: attached.resources,
          lockedRelationCount:
            included.lockedRelationCount + attached.lockedRelationCount,
        };
      },
    );
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
    const resources = await reader.listVisibleObjects(principal, objectIds);
    return {
      resources,
      lockedRelationCount: objectIds.length - resources.length,
    };
  }
}

function timelineItem(resource: TimelineResource): TimelineItem[] {
  const occursOn =
    resource.objectType === "event"
      ? resource.startsOn
      : resource.objectType === "task"
        ? resource.dueOn
        : null;
  if (occursOn !== null)
    return [
      {
        canonicalObjectId: resource.id,
        objectType: resource.objectType,
        displayName: resource.displayName,
        occursAt: null,
        occursOn,
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
  readonly #calendarReads: CalendarReadRepository;
  readonly #projectionReads: ProjectionReadRepository;
  readonly #noteReads: NoteReadRepository;
  readonly #sectionReads: SectionReadRepository;

  constructor(
    database: Database,
    calendarReads?: CalendarReadRepository,
    projectionReads?: ProjectionReadRepository,
    noteReads?: NoteReadRepository,
    sectionReads?: SectionReadRepository,
  ) {
    this.#calendarReads =
      calendarReads ?? new PostgresCalendarReadRepository(database);
    this.#projectionReads =
      projectionReads ?? new PostgresProjectionReadRepository(database);
    this.#noteReads = noteReads ?? new PostgresNoteReadRepository(database);
    this.#sectionReads =
      sectionReads ?? new PostgresSectionRepository(database);
  }

  async getAttachmentTargets(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<EventAttachmentTargetsResponse> {
    const { event, included } =
      await this.#projectionReads.readAttachmentTargets(principal, eventId);
    const summary = ({
      id,
      displayName,
    }: {
      id: string;
      displayName: string;
    }) => ({ id, displayName });
    return {
      event,
      tasks: included
        .filter(({ objectType }) => objectType === "task")
        .map(summary),
      expenses: included
        .filter(({ objectType }) => objectType === "expense")
        .map(summary),
    };
  }

  async getDetail(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<EventDetailProjection> {
    const detail = await this.#projectionReads.readEventDetail(
      principal,
      eventId,
    );
    const included = detail.includedResources;
    const documents = new Map(
      [
        ...included.filter((resource) => isResource(resource, "document")),
        ...detail.attachedDocuments,
      ].map((document) => [document.id, document]),
    );

    return {
      event: detail.event,
      events: included.filter((resource) => isResource(resource, "event")),
      tasks: included.filter((resource) => isResource(resource, "task")),
      expenses: included.filter((resource) => isResource(resource, "expense")),
      reminders: included.filter((resource) =>
        isResource(resource, "reminder"),
      ),
      persons: included
        .filter((resource) => isResource(resource, "person"))
        .sort(comparePersonNames),
      documents: [...documents.values()],
      lockedRelationCount: detail.lockedRelationCount,
    };
  }

  async getTodos(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<TaskResourceProjection> {
    const resources = await this.#getProjectionResources(principal, eventId, [
      "task",
    ]);
    const sections = await this.#sectionReads.listSections(
      principal,
      eventId,
      "todos",
    );
    // A date-only due sorts at the start of its day (UTC), before any
    // timed task that day, and undated tasks come last.
    const items = resources.sort((first, second) =>
      compareDates(dueInstant(first), dueInstant(second), first.id, second.id),
    );
    return { sourceEventId: eventId, items, sections };
  }

  async getCalendar(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<EventResourceProjection> {
    const resources = await this.#calendarReads.listCalendarEvents(
      principal,
      eventId,
    );
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
    const sections = await this.#sectionReads.listSections(
      principal,
      eventId,
      "expenses",
    );
    const items = resources.sort((first, second) =>
      compareDates(second.occurredAt, first.occurredAt, second.id, first.id),
    );
    return { sourceEventId: eventId, items, sections };
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

  async getPeople(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<PersonResourceProjection> {
    const resources = await this.#getProjectionResources(principal, eventId, [
      "person",
    ]);
    return {
      sourceEventId: eventId,
      items: resources.sort(comparePersonNames),
    };
  }

  /** The Event's notes, last edited first or by title, each with who wrote its current version. */
  getNotes(
    principal: UserPrincipal,
    eventId: string,
    input: NoteListQueryInput = {},
  ): Promise<NotePage> {
    return this.#noteReads.listNotes(principal, eventId, input);
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

  async #getProjectionResources<Type extends ProjectionObjectType>(
    principal: UserPrincipal,
    eventId: string,
    objectTypes: readonly Type[],
  ): Promise<Extract<EventPlanningResource, { objectType: Type }>[]> {
    const resources = await this.#projectionReads.listIncludedResources(
      principal,
      eventId,
      objectTypes,
    );
    return [...resources];
  }
}

async function readProjectionResources<Type extends ProjectionObjectType>(
  database: Database,
  principal: UserPrincipal,
  eventId: string,
  objectTypes: readonly Type[],
): Promise<Extract<EventPlanningResource, { objectType: Type }>[]> {
  return withReadAuthorization(database, async (transaction, authorization) => {
    const reader = new EventPlanningObjectService({
      database: transaction,
      authorization,
    });
    await reader.getEvent(principal, eventId);
    const relations = await transaction
      .select({ targetObjectId: objectRelations.targetObjectId })
      .from(objectRelations)
      .innerJoin(
        objects,
        and(
          eq(objects.workspaceId, objectRelations.workspaceId),
          eq(objects.id, objectRelations.targetObjectId),
          isNull(objects.deletedAt),
          inArray(objects.objectType, [...objectTypes]),
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
    const resources = await reader.listVisibleObjects(
      principal,
      relations.map(({ targetObjectId }) => targetObjectId),
    );
    return resources.filter(
      (
        resource,
      ): resource is Extract<EventPlanningResource, { objectType: Type }> =>
        objectTypes.some((type) => resource.objectType === type),
    );
  });
}
