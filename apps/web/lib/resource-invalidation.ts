import type { EventPlanningResourceResponse } from "@chronelle/schemas";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

type ChangedResource = Pick<EventPlanningResourceResponse, "id" | "objectType">;

const projections: Record<ChangedResource["objectType"], readonly string[]> = {
  event: ["detail", "calendar", "timeline", "itinerary", "attachment-targets"],
  task: ["detail", "todos", "timeline", "attachment-targets"],
  expense: ["detail", "expenses", "timeline", "attachment-targets"],
  reminder: ["detail", "reminders", "timeline"],
  person: ["detail", "people", "shares"],
  note: ["detail", "notes"],
  document: ["detail"],
};

function dependsOnResource(
  [family, id, view, nested]: QueryKey,
  resource: ChangedResource,
): boolean {
  switch (family) {
    case "search":
      return true;
    case "events":
      return resource.objectType === "event";
    case "tasks":
      return resource.objectType === "task" || resource.objectType === "event";
    case "persons":
      return resource.objectType === "person";
    case "event":
      return (
        (id === resource.id && (view === "resource" || view === "access")) ||
        projections[resource.objectType].includes(String(view))
      );
    case "object":
      return (
        id === resource.id ||
        view === "removed-relations" ||
        (resource.objectType === "event" &&
          view === "resource" &&
          nested === "events")
      );
    default:
      return false;
  }
}

/**
 * Refreshes content dependencies in every context, including filtered lists
 * the resource can enter. Relationships and permission changes require the
 * broader canonical invalidation.
 */
export function invalidateResourceQueries(
  client: QueryClient,
  resource: ChangedResource,
): Promise<void> {
  return client.invalidateQueries({
    predicate: (query) => dependsOnResource(query.queryKey, resource),
  });
}
