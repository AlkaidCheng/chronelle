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
    views: ["list", "by-day", "week", "month"],
  },
  calendar: {
    label: "Calendar",
    description: "Plan dates, times, and multi-day activities.",
    keywords: "schedule activities agenda itinerary running order",
    views: ["list", "agenda", "week", "month"],
  },
  timeline: {
    label: "Timeline",
    description: "See dated plans, tasks, spending, and reminders in order.",
    keywords: "chronological overview",
    views: ["list"],
  },
  // A kind saved layouts may still carry; it shows as the Calendar's agenda.
  itinerary: {
    label: "Itinerary",
    description: "Follow the running order of your scheduled activities.",
    keywords: "agenda schedule",
    views: ["list"],
    aliasOf: { kind: "calendar", view: "agenda" },
  },
  expenses: {
    label: "Expenses",
    description: "Record transactions and see totals by currency.",
    keywords: "costs spending payments",
    views: ["list", "by-day", "week", "month"],
  },
  reminders: {
    label: "Reminders",
    description: "Track upcoming nudges. Notifications are not sent yet.",
    keywords: "alerts notifications",
    views: ["list", "by-day", "week", "month"],
  },
  files: {
    label: "Files",
    description:
      "Manage private attachments on this event, its tasks, and expenses.",
    keywords: "documents receipts",
    views: ["list"],
  },
  people: {
    label: "People",
    description: "See who is involved in this event, as namecards.",
    keywords: "persons contacts attendees guests",
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
    /** A retired kind that renders as another kind's view; not offered anew. */
    aliasOf?: {
      readonly kind: EventComponentKind;
      readonly view: EventComponentView;
    };
  }
>;

export const eventComponentViews: Record<
  EventComponentView,
  { readonly label: string }
> = {
  list: { label: "List" },
  agenda: { label: "Agenda" },
  "by-day": { label: "By day" },
  week: { label: "By week" },
  month: { label: "Calendar" },
};

/** The status read after a view is chosen: "Shown by day.", "Shown as a calendar." */
export function describeShownView(view: EventComponentView): string {
  const label = eventComponentViews[view].label.toLowerCase();
  if (label.startsWith("by ")) return `Shown ${label}.`;
  return `Shown as ${/^[aeiou]/.test(label) ? "an" : "a"} ${label}.`;
}

/** The kinds a page may add; retired aliases are left out. */
export const addableEventComponentKinds: readonly EventComponentKind[] =
  eventComponentKindSchema.options.filter(
    (kind) => aliasOf(kind) === undefined,
  );

function aliasOf(kind: EventComponentKind) {
  const entry: {
    readonly aliasOf?: {
      readonly kind: EventComponentKind;
      readonly view: EventComponentView;
    };
    readonly label: string;
  } = eventComponents[kind];
  return entry.aliasOf;
}

/** The kind and view a component renders as, aliases resolved. */
export function resolveEventComponent(component: {
  readonly kind: EventComponentKind;
  readonly view?: EventComponentView | undefined;
}): { readonly kind: EventComponentKind; readonly view: EventComponentView } {
  const alias = aliasOf(component.kind);
  if (alias !== undefined) return alias;
  return { kind: component.kind, view: viewOf(component) };
}

/** The views a kind offers, the first being its default; an alias offers its target's. */
export function viewsOf(
  kind: EventComponentKind,
): readonly EventComponentView[] {
  const alias = aliasOf(kind);
  if (alias !== undefined) return viewsOf(alias.kind);
  const entry: { views?: readonly EventComponentView[] } =
    eventComponents[kind];
  return entry.views ?? ["list"];
}

/** The view a component shows: its own when the kind offers it, else the default. */
export function viewOf(component: {
  readonly kind: EventComponentKind;
  readonly view?: EventComponentView | undefined;
}): EventComponentView {
  const alias = aliasOf(component.kind);
  if (alias !== undefined) return alias.view;
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
  return addableEventComponentKinds.filter((kind) => {
    const { label, description, keywords } = eventComponents[kind];
    const text = `${kind} ${label} ${description} ${keywords}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
