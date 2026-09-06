export const eventViews = [
  { id: "overview", label: "Overview" },
  { id: "todos", label: "To-dos" },
  { id: "calendar", label: "Calendar" },
  { id: "timeline", label: "Timeline" },
  { id: "itinerary", label: "Itinerary" },
  { id: "expenses", label: "Expenses" },
  { id: "reminders", label: "Reminders" },
  { id: "files", label: "Files" },
  { id: "sharing", label: "Sharing" },
  { id: "removed-links", label: "Removed links" },
] as const;

export type EventView = (typeof eventViews)[number]["id"];

export function parseEventView(value: string | null): EventView {
  return eventViews.find((view) => view.id === value)?.id ?? "overview";
}
