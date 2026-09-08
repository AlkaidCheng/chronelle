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
function snapshot(): EventView {
  return parseEventView(
    new URLSearchParams(window.location.search).get("view"),
  );
}
function selectView(view: EventView) {
  if (snapshot() === view) return;
  const url = new URL(window.location.href);
  if (view === "pages") url.searchParams.delete("view");
  else url.searchParams.set("view", view);
  window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(viewChange));
}

/** Keeps client-side projections bookmarkable without remounting open editors. */
export function useEventView() {
  const view = useSyncExternalStore(
    subscribe,
    snapshot,
    (): EventView | null => null,
  );
  return [view, selectView] as const;
}
