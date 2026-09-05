import { serializeResource } from "@chronelle/object-model";
import type {
  EventDetailProjection,
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

export { serializeResource } from "@chronelle/object-model";
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
