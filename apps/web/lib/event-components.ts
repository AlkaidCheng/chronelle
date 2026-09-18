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
    keywords: "schedule activities agenda itinerary running order",
    views: ["list", "agenda", "week", "month"],
  },
  timeline: {
    keywords: "chronological overview",
    views: ["list"],
  },
  // A kind saved layouts may still carry; it shows as the Calendar's agenda.
  itinerary: {
    keywords: "agenda schedule",
    views: ["list"],
    aliasOf: { kind: "calendar", view: "agenda" },
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
} satisfies Record<
  EventComponentKind,
  {
    /** English search terms for the component picker, beside the localized name. */
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
  return tr("views")(kind === "itinerary" ? "itinerary" : kind);
}

/** What a component kind is for, in the active language. */
export function componentKindDescription(kind: EventComponentKind): string {
  return tr("views.descriptions")(kind);
}

/** The status read after a view is chosen: "Shown by day.", "Shown as a calendar." */
export function describeShownView(view: EventComponentView): string {
  return tr("layouts.shown")(viewKeys[view]);
}

/** A retired kind kept for saved layouts, shown as another kind's view. */
type AliasedEventComponentKind = {
  [K in EventComponentKind]: (typeof eventComponents)[K] extends {
    readonly aliasOf: unknown;
  }
    ? K
    : never;
}[EventComponentKind];

/** A kind a page may add: every kind but the retired aliases. */
export type AddableEventComponentKind = Exclude<
  EventComponentKind,
  AliasedEventComponentKind
>;

export const addableEventComponentKinds: readonly AddableEventComponentKind[] =
  eventComponentKindSchema.options.filter(
    (kind): kind is AddableEventComponentKind => aliasOf(kind) === undefined,
  );

function aliasOf(kind: EventComponentKind) {
  const entry: {
    readonly aliasOf?: {
      readonly kind: EventComponentKind;
      readonly view: EventComponentView;
    };
    readonly keywords: string;
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

export function findEventComponents(
  query: string,
): AddableEventComponentKind[] {
  const terms = query
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/^\//, "")
    .split(/[\s-]+/)
    .filter(Boolean);
  return addableEventComponentKinds.filter((kind) => {
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
