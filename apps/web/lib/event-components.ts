import {
  eventComponentKindSchema,
  type EventComponentKind,
  type EventComponentView,
} from "@chronelle/schemas";

export const eventComponents = {
  todos: {
    label: "To-dos",
    description: "Add tasks and track what needs doing.",
    keywords: "tasks checklist todo",
    views: ["list", "by-day"],
  },
  calendar: {
    label: "Calendar",
    description: "Plan dates, times, and multi-day activities.",
    keywords: "schedule activities",
    views: ["list"],
  },
  timeline: {
    label: "Timeline",
    description: "See dated plans, tasks, spending, and reminders in order.",
    keywords: "chronological overview",
    views: ["list"],
  },
  itinerary: {
    label: "Itinerary",
    description: "Follow the running order of your scheduled activities.",
    keywords: "agenda schedule",
    views: ["list"],
  },
  expenses: {
    label: "Expenses",
    description: "Record transactions and see totals by currency.",
    keywords: "costs spending payments",
    views: ["list"],
  },
  reminders: {
    label: "Reminders",
    description: "Track upcoming nudges. Notifications are not sent yet.",
    keywords: "alerts notifications",
    views: ["list"],
  },
  files: {
    label: "Files",
    description:
      "Manage private attachments on this event, its tasks, and expenses.",
    keywords: "documents receipts",
    views: ["list"],
  },
} satisfies Record<
  EventComponentKind,
  {
    label: string;
    description: string;
    keywords: string;
    /** The views the kind offers, the first being its default. */
    views: readonly EventComponentView[];
  }
>;

export const eventComponentViews: Record<
  EventComponentView,
  { readonly label: string }
> = {
  list: { label: "List" },
  "by-day": { label: "By day" },
};

/** The views a kind offers, the first being its default. */
export function viewsOf(
  kind: EventComponentKind,
): readonly EventComponentView[] {
  const entry: { views?: readonly EventComponentView[] } =
    eventComponents[kind];
  return entry.views ?? ["list"];
}

/** The view a component shows: its own when the kind offers it, else the default. */
export function viewOf(component: {
  readonly kind: EventComponentKind;
  readonly view?: EventComponentView | undefined;
}): EventComponentView {
  const views = viewsOf(component.kind);
  return component.view !== undefined && views.includes(component.view)
    ? component.view
    : (views[0] ?? "list");
}

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
