import type { EventComponentKind } from "@chronelle/schemas";

import {
  getMessages,
  type AppLocale,
  type MessageKey,
} from "../../i18n/catalog";

export const planningComponentKinds = [
  "todos",
  "calendar",
  "timeline",
  "itinerary",
  "expenses",
  "reminders",
] as const satisfies readonly EventComponentKind[];

export type PlanningComponentKind = (typeof planningComponentKinds)[number];

const componentLabelKeys = {
  todos: "componentTodos",
  calendar: "componentCalendar",
  timeline: "componentTimeline",
  itinerary: "componentItinerary",
  expenses: "componentExpenses",
  reminders: "componentReminders",
  files: "componentFiles",
  people: "componentPeople",
  notes: "componentNotes",
} as const satisfies Record<EventComponentKind, MessageKey>;

export function isPlanningComponentKind(
  kind: EventComponentKind,
): kind is PlanningComponentKind {
  return planningComponentKinds.some((candidate) => candidate === kind);
}

export function componentLabel(
  kind: EventComponentKind,
  locale: AppLocale,
): string {
  return getMessages(locale)[componentLabelKeys[kind]];
}
