import type { LivTalesApiClient } from "@livtales/api-client";
import type {
  EventResourceProjectionResponse,
  ExpenseResourceProjectionResponse,
  ReminderResourceProjectionResponse,
  TaskResourceProjectionResponse,
  TimelineResponse,
} from "@livtales/schemas";

import type { PlanningComponentKind } from "./catalog";

export type PlanningProjection =
  | { readonly kind: "todos"; readonly value: TaskResourceProjectionResponse }
  | {
      readonly kind: "calendar";
      readonly value: EventResourceProjectionResponse;
    }
  | { readonly kind: "timeline"; readonly value: TimelineResponse }
  | {
      readonly kind: "itinerary";
      readonly value: EventResourceProjectionResponse;
    }
  | {
      readonly kind: "expenses";
      readonly value: ExpenseResourceProjectionResponse;
    }
  | {
      readonly kind: "reminders";
      readonly value: ReminderResourceProjectionResponse;
    };

type ProjectionClient = Pick<
  LivTalesApiClient,
  | "getEventCalendar"
  | "getEventExpenses"
  | "getEventItinerary"
  | "getEventReminders"
  | "getEventTimeline"
  | "getEventTodos"
>;

export async function loadPlanningProjection(
  client: ProjectionClient,
  eventId: string,
  kind: PlanningComponentKind,
): Promise<PlanningProjection> {
  switch (kind) {
    case "todos":
      return { kind, value: await client.getEventTodos(eventId) };
    case "calendar":
      return { kind, value: await client.getEventCalendar(eventId) };
    case "timeline":
      return { kind, value: await client.getEventTimeline(eventId) };
    case "itinerary":
      return { kind, value: await client.getEventItinerary(eventId) };
    case "expenses":
      return { kind, value: await client.getEventExpenses(eventId) };
    case "reminders":
      return { kind, value: await client.getEventReminders(eventId) };
  }
}

export function planningLayoutQueryKey(workspaceId: string, eventId: string) {
  return ["wechat-event-layout", workspaceId, eventId] as const;
}

export function planningProjectionQueryKey(
  workspaceId: string,
  eventId: string,
  kind?: PlanningComponentKind,
) {
  return kind === undefined
    ? (["wechat-event-projection", workspaceId, eventId] as const)
    : (["wechat-event-projection", workspaceId, eventId, kind] as const);
}
