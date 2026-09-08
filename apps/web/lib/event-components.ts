import type { EventComponentKind } from "@chronelle/schemas";

export const eventComponents = {
  todos: {
    label: "To-dos",
    description: "Add tasks and track what needs doing.",
  },
  calendar: {
    label: "Calendar",
    description: "Plan dates, times, and multi-day activities.",
  },
  timeline: {
    label: "Timeline",
    description: "See dated plans, tasks, spending, and reminders in order.",
  },
  itinerary: {
    label: "Itinerary",
    description: "Follow the running order of your scheduled activities.",
  },
  expenses: {
    label: "Expenses",
    description: "Record transactions and see totals by currency.",
  },
  reminders: {
    label: "Reminders",
    description: "Track upcoming nudges. Notifications are not sent yet.",
  },
  files: {
    label: "Files",
    description:
      "Manage private attachments on this event, its tasks, and expenses.",
  },
} satisfies Record<EventComponentKind, { label: string; description: string }>;
