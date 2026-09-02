import type {
  EventDetailProjection,
  EventPlanningResource,
  EventResourceProjection,
  ExpenseResourceProjection,
  ObjectDeletionResource,
  ObjectRelationResource,
  RelationDeletionResource,
  ReminderResourceProjection,
  TaskResourceProjection,
  TimelineProjection,
} from "@chronelle/object-model";

function serializeDate(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export function serializeResource(resource: EventPlanningResource) {
  const canonical = {
    id: resource.id,
    workspaceId: resource.workspaceId,
    objectType: resource.objectType,
    displayName: resource.displayName,
    createdBy: resource.createdBy,
    permissionScopeId: resource.permissionScopeId,
    createdAt: resource.createdAt.toISOString(),
    updatedAt: resource.updatedAt.toISOString(),
    version: resource.version,
    archivedAt: serializeDate(resource.archivedAt),
    deletedAt: serializeDate(resource.deletedAt),
    customProperties: resource.customProperties,
    metadata: resource.metadata,
  };

  switch (resource.objectType) {
    case "event":
      return {
        ...canonical,
        objectType: "event" as const,
        startsAt: serializeDate(resource.startsAt),
        endsAt: serializeDate(resource.endsAt),
        timezone: resource.timezone,
        isAllDay: resource.isAllDay,
      };
    case "task":
      return {
        ...canonical,
        objectType: "task" as const,
        status: resource.status,
        dueAt: serializeDate(resource.dueAt),
        completedAt: serializeDate(resource.completedAt),
      };
    case "expense":
      return {
        ...canonical,
        objectType: "expense" as const,
        amount: resource.amount,
        currency: resource.currency,
        occurredAt: resource.occurredAt.toISOString(),
      };
    case "reminder":
      return {
        ...canonical,
        objectType: "reminder" as const,
        remindAt: resource.remindAt.toISOString(),
        status: resource.status,
      };
    case "document":
      return {
        ...canonical,
        objectType: "document" as const,
        storageProvider: resource.storageProvider,
        storageKey: resource.storageKey,
        originalFilename: resource.originalFilename,
        mimeType: resource.mimeType,
        sizeBytes: resource.sizeBytes.toString(),
        checksumSha256: resource.checksumSha256,
        encryptionMode: resource.encryptionMode,
      };
  }
}

export function serializeRelation(relation: ObjectRelationResource) {
  return {
    ...relation,
    createdAt: relation.createdAt.toISOString(),
    deletedAt: serializeDate(relation.deletedAt),
  };
}

export function serializeObjectDeletion(deletion: ObjectDeletionResource) {
  return { ...deletion, deletedAt: deletion.deletedAt.toISOString() };
}

export function serializeRelationDeletion(deletion: RelationDeletionResource) {
  return { ...deletion, deletedAt: deletion.deletedAt.toISOString() };
}

export function serializeEventDetail(projection: EventDetailProjection) {
  return {
    event: serializeResource(projection.event),
    events: projection.events.map(serializeResource),
    tasks: projection.tasks.map(serializeResource),
    expenses: projection.expenses.map(serializeResource),
    reminders: projection.reminders.map(serializeResource),
    documents: projection.documents.map(serializeResource),
    lockedRelationCount: projection.lockedRelationCount,
  };
}

export function serializeResourceProjection(
  projection:
    | EventResourceProjection
    | TaskResourceProjection
    | ExpenseResourceProjection
    | ReminderResourceProjection,
) {
  return {
    sourceEventId: projection.sourceEventId,
    items: projection.items.map(serializeResource),
  };
}

export function serializeTimeline(projection: TimelineProjection) {
  return {
    sourceEventId: projection.sourceEventId,
    items: projection.items.map((item) => ({
      ...item,
      occursAt: item.occursAt.toISOString(),
    })),
  };
}
