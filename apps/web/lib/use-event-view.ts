"use client";

import { useSyncExternalStore } from "react";
import { type EventView, parseEventView } from "./event-views";

const viewChange = "chronelle:event-view";
function subscribe(onChange: () => void) {
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
