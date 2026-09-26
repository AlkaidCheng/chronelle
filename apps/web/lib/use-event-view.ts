"use client";

import { type EventView, parseEventView } from "./event-views";
import { readAddress, useAddress, writeAddress } from "./location-store";

function useEventLocation() {
  const location = useAddress();
  function select(name: "view" | "page", value: string | null) {
    if (!location) return;
    const url = readAddress();
    if (url.pathname !== location.pathname || url.hash !== location.hash)
      return;
    if (url.searchParams.get(name) === value) return;
    if (value === null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    writeAddress(url, "push");
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
