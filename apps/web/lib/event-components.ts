import {
  type EventComponentKind,
  type EventComponentView,
  eventComponentKindSchema,
} from "@chronelle/schemas";
import { tr } from "../i18n/active-locale";

export const eventComponents = {
  todos: {
    keywords: "tasks checklist todo",
    views: ["list", "by-day", "week", "month"],
  },
  calendar: {
    keywords: "schedule activities agenda running order",
    views: ["list", "agenda", "week", "month"],
  },
  timeline: {
    keywords: "chronological overview",
    views: ["list"],
  },
  itinerary: {
    keywords: "day sheet places trip running order",
    views: ["by-day", "list"],
  },
  expenses: {
    keywords: "costs spending payments",
    views: ["list", "by-day", "week", "month"],
  },
  reminders: {
    keywords: "alerts notifications",
    views: ["list", "by-day", "week", "month"],
  },
  files: {
    keywords: "documents receipts",
    views: ["list"],
  },
  people: {
    keywords: "persons contacts attendees guests",
    views: ["list"],
  },
  notes: {
    keywords: "text memo address remember",
    views: ["list"],
  },
} satisfies Record<
  EventComponentKind,
  {
    /** English search terms for the component picker, beside the localized name. */
    keywords: string;
    /** The views the kind offers, the first being its default. */
    views: readonly EventComponentView[];
  }
>;

const viewKeys = {
  list: "list",
  agenda: "agenda",
  "by-day": "byDay",
  week: "week",
  month: "month",
} as const satisfies Record<EventComponentView, string>;

/** A component view's name in the active language. */
export function componentViewLabel(view: EventComponentView): string {
  return tr("layouts")(viewKeys[view]);
}

/** A component kind's name in the active language. */
export function componentKindLabel(kind: EventComponentKind): string {
  return tr("views")(kind);
}

/** What a component kind is for, in the active language. */
export function componentKindDescription(kind: EventComponentKind): string {
  return tr("views.descriptions")(kind);
}

/** The status read after a view is chosen: "Shown by day.", "Shown as a calendar." */
export function describeShownView(view: EventComponentView): string {
  return tr("layouts.shown")(viewKeys[view]);
}

/** The kinds a page may add, in the gallery's order. */
export const eventComponentKinds: readonly EventComponentKind[] =
  eventComponentKindSchema.options;

/** The views a kind offers, the first being its default. */
export function viewsOf(
  kind: EventComponentKind,
): readonly EventComponentView[] {
  return eventComponents[kind].views;
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
  return eventComponentKinds.filter((kind) => {
    const text = [
      kind,
      eventComponents[kind].keywords,
      componentKindLabel(kind),
      componentKindDescription(kind),
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
