import { tr } from "../i18n/active-locale";

export const eventViews = [
  { id: "pages" },
  { id: "overview" },
  { id: "todos" },
  { id: "calendar" },
  { id: "timeline" },
  { id: "itinerary" },
  { id: "expenses" },
  { id: "reminders" },
  { id: "files" },
  { id: "people" },
  { id: "notes" },
  { id: "sharing" },
  { id: "removed-links" },
] as const;

export type EventView = (typeof eventViews)[number]["id"];

const viewKeys = {
  pages: "pages",
  overview: "overview",
  todos: "todos",
  calendar: "calendar",
  timeline: "timeline",
  itinerary: "itinerary",
  expenses: "expenses",
  reminders: "reminders",
  files: "files",
  people: "people",
  notes: "notes",
  sharing: "sharing",
  "removed-links": "removedLinks",
} as const satisfies Record<EventView, string>;

/** A view's name in the active language. */
export function eventViewLabel(view: EventView): string {
  return tr("views")(viewKeys[view]);
}

/** What a view shows, in one line in the active language. */
export function eventViewDescription(view: EventView): string {
  return tr("views.descriptions")(viewKeys[view]);
}

export function parseEventView(value: string | null): EventView {
  return eventViews.find((view) => view.id === value)?.id ?? "pages";
}
