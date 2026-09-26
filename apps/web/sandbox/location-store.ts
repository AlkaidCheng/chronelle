import { useMemo, useSyncExternalStore } from "react";

/**
 * The sandbox is one offline file, so the app's address lives in its
 * fragment (`#/events/<id>?view=todos`); this module stands in for
 * `lib/location-store.ts` and reads and writes the address there. The base
 * only lets the fragment parse as a URL.
 */
const base = "https://sandbox.invalid";
const addressChange = "livtales:address";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  window.addEventListener(addressChange, onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(addressChange, onChange);
  };
}

function snapshot() {
  return window.location.hash.slice(1) || "/events";
}

export function useAddress(): URL | null {
  const path = useSyncExternalStore(subscribe, snapshot);
  return useMemo(() => new URL(path, base), [path]);
}

export function readAddress(): URL {
  return new URL(snapshot(), base);
}

export function writeAddress(url: URL, mode: "push" | "replace"): void {
  const fragment = `#${url.pathname}${url.search}`;
  if (mode === "push") window.history.pushState(null, "", fragment);
  else window.history.replaceState(null, "", fragment);
  window.dispatchEvent(new Event(addressChange));
}
