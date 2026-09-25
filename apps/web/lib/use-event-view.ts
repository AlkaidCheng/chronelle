"use client";

import { useSyncExternalStore } from "react";
import { type EventView, parseEventView } from "./event-views";

const viewChange = "livtales:event-view";

/**
 * A client-side link to this event with another view changes the address
 * through the history API without a popstate event; announcing every push
 * and replace lets the view follow it. Applied once per page.
 */
let historyAnnounced = false;
function announceHistoryChanges() {
  if (historyAnnounced) return;
  historyAnnounced = true;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method];
    window.history[method] = function announce(
      this: History,
      ...args: Parameters<History["pushState"]>
    ) {
      original.apply(this, args);
      window.dispatchEvent(new Event(viewChange));
    };
  }
}

function subscribe(onChange: () => void) {
  announceHistoryChanges();
  window.addEventListener("popstate", onChange);
  window.addEventListener(viewChange, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(viewChange, onChange);
  };
}
function snapshot() {
  return window.location.href;
}

function useEventLocation() {
  const href = useSyncExternalStore(subscribe, snapshot, () => null);
  const location = href === null ? null : new URL(href);
  function select(name: "view" | "page", value: string | null) {
    if (!location) return;
    const url = new URL(window.location.href);
    if (url.pathname !== location.pathname || url.hash !== location.hash)
      return;
    if (url.searchParams.get(name) === value) return;
    if (value === null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    window.history.pushState(null, "", url);
    window.dispatchEvent(new Event(viewChange));
  }
  return { location, select };
}

/** Keeps client-side projections bookmarkable without remounting open editors. */
export function useEventView() {
  const { location, select } = useEventLocation();
  const view = location && parseEventView(location.searchParams.get("view"));
  const selectView = (value: EventView) =>
    select("view", value === "pages" ? null : value);
  return [view, selectView] as const;
}

export function useEventPage() {
  const { location, select } = useEventLocation();
  return [
    location?.searchParams.get("page") ?? null,
    (id: string) => select("page", id),
  ] as const;
}
