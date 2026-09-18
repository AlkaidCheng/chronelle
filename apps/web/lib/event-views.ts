import { tr } from "../i18n/active-locale";

export const eventViews = [
  { id: "pages" },
  { id: "overview" },
  { id: "todos" },
  { id: "calendar" },
  { id: "timeline" },
  { id: "expenses" },
  { id: "reminders" },
  { id: "files" },
  { id: "people" },
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
  expenses: "expenses",
  reminders: "reminders",
  files: "files",
  people: "people",
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
  // The Itinerary tab folded into the Calendar; its links still open.
  if (value === "itinerary") return "calendar";
  return eventViews.find((view) => view.id === value)?.id ?? "pages";
}
