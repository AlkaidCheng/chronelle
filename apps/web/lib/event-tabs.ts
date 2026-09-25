import type {
  EventTabs,
  EventTabsPreference,
  PreferencesRequest,
} from "@livtales/schemas";
import { type EventView, eventViews } from "./event-views";

/** The views an event's strip can list: every event view but the pages. */
export const stripViews: readonly EventView[] = eventViews
  .map((view) => view.id)
  .filter((view) => view !== "pages");

/** The views an event always has: they can be hidden but not removed. */
export const fixedViews: ReadonlySet<EventView> = new Set<EventView>([
  "overview",
  "todos",
  "sharing",
  "removed-links",
]);

/** The views the gallery offers: the specialized components, not the Overview or the recovery list. */
export const galleryViews: readonly EventView[] = stripViews.filter(
  (view) => view !== "overview" && view !== "removed-links",
);

/** An event's tabs as shown: the views on the event in order, and what the strip leaves out. */
export interface TabArrangement {
  readonly order: readonly EventView[];
  /** View keys and page ids kept off the strip. */
  readonly hidden: ReadonlySet<string>;
  /** Views taken off the event until added again. */
  readonly removed: ReadonlySet<EventView>;
}

/**
 * Applies an event's tab preference to the views the app offers: removed
 * views are left out (a fixed view never is), the kept order comes first
 * and views it does not name follow in default order; keys the app does
 * not know are ignored. Hidden keys are kept as given, since they name
 * pages as well as views.
 */
export function arrangeEventTabs(
  tabs: EventTabsPreference,
  known: readonly EventView[],
): TabArrangement {
  const removed = new Set(
    known.filter(
      (view) => !fixedViews.has(view) && (tabs.removed ?? []).includes(view),
    ),
  );
  const offered = known.filter((view) => !removed.has(view));
  const kept = (tabs.order ?? []).filter((key): key is EventView =>
    offered.includes(key as EventView),
  );
  return {
    order: [...kept, ...offered.filter((view) => !kept.includes(view))],
    hidden: new Set(tabs.hidden ?? []),
    removed,
  };
}

const pageIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The preference to keep for an arrangement. A view key the app does not
 * know is carried as it was, for a view that ships later; `pageIds` names
 * the pages that exist, so a hidden page that is gone drops out.
 */
export function eventTabsPreferenceOf(
  arrangement: TabArrangement,
  previous: EventTabsPreference,
  known: readonly EventView[],
  pageIds: readonly string[],
): EventTabsPreference {
  const isView = (key: string) => known.includes(key as EventView);
  const unknown = (keys: readonly string[] | undefined) =>
    (keys ?? []).filter((key) => !isView(key) && !pageIdPattern.test(key));
  return {
    order: [...arrangement.order, ...unknown(previous.order)],
    hidden: [
      ...[...arrangement.hidden].filter(
        (key) => isView(key) || pageIds.includes(key),
      ),
      ...unknown(previous.hidden),
    ],
    removed: [...arrangement.removed, ...unknown(previous.removed)],
  };
}

/** The stored tabs with a request's events replaced or, for null, dropped. */
export function mergeEventTabs(
  current: EventTabs,
  changes: PreferencesRequest["eventTabs"],
): EventTabs {
  if (changes === undefined) return current;
  const next: Record<string, EventTabsPreference> = { ...current };
  for (const [eventId, tabs] of Object.entries(changes)) {
    if (tabs === null) delete next[eventId];
    else next[eventId] = tabs;
  }
  return next;
}
