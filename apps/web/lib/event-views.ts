import { tr } from "../i18n/active-locale";

export const eventViews = [
  { id: "pages", label: "Pages" },
  { id: "overview", label: "Overview" },
  { id: "todos", label: "To-dos" },
  { id: "calendar", label: "Calendar" },
  { id: "timeline", label: "Timeline" },
  { id: "expenses", label: "Expenses" },
  { id: "reminders", label: "Reminders" },
  { id: "files", label: "Files" },
  { id: "people", label: "People" },
  { id: "sharing", label: "Sharing" },
  { id: "removed-links", label: "Removed links" },
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

export function parseEventView(value: string | null): EventView {
  // The Itinerary tab folded into the Calendar; its links still open.
  if (value === "itinerary") return "calendar";
  return eventViews.find((view) => view.id === value)?.id ?? "pages";
}
