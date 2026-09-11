import {
  eventComponentKindSchema,
  type EventComponentKind,
} from "@chronelle/schemas";

export const eventComponents = {
  todos: {
    label: "To-dos",
    description: "Add tasks and track what needs doing.",
    keywords: "tasks checklist todo",
  },
  calendar: {
    label: "Calendar",
    description: "Plan dates, times, and multi-day activities.",
    keywords: "schedule activities",
  },
  timeline: {
    label: "Timeline",
    description: "See dated plans, tasks, spending, and reminders in order.",
    keywords: "chronological overview",
  },
  itinerary: {
    label: "Itinerary",
    description: "Follow the running order of your scheduled activities.",
    keywords: "agenda schedule",
  },
  expenses: {
    label: "Expenses",
    description: "Record transactions and see totals by currency.",
    keywords: "costs spending payments",
  },
  reminders: {
    label: "Reminders",
    description: "Track upcoming nudges. Notifications are not sent yet.",
    keywords: "alerts notifications",
  },
  files: {
    label: "Files",
    description:
      "Manage private attachments on this event, its tasks, and expenses.",
    keywords: "documents receipts",
  },
} satisfies Record<
  EventComponentKind,
  { label: string; description: string; keywords: string }
>;

export function findEventComponents(query: string): EventComponentKind[] {
  const terms = query
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/^\//, "")
    .split(/[\s-]+/)
    .filter(Boolean);
  return eventComponentKindSchema.options.filter((kind) => {
    const { label, description, keywords } = eventComponents[kind];
    const text = `${kind} ${label} ${description} ${keywords}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
