"use client";

import { useMemo, useSyncExternalStore } from "react";

const addressChange = "livtales:address";

/**
 * A client-side link to the same page with another query changes the address
 * through the history API without a popstate event; announcing every push
 * and replace lets the address follow it. Applied once per page.
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
      window.dispatchEvent(new Event(addressChange));
    };
  }
}

function subscribe(onChange: () => void) {
  announceHistoryChanges();
  window.addEventListener("popstate", onChange);
  window.addEventListener(addressChange, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(addressChange, onChange);
  };
}
function snapshot() {
  return window.location.href;
}

/**
 * The page's address, following every push, replace, and Back or Forward;
 * null while rendering on the server. What the page shows from its query
 * (an event's view, an open dialog) reads it here, so changing the query
 * never remounts the page.
 */
export function useAddress(): URL | null {
  const href = useSyncExternalStore(subscribe, snapshot, () => null);
  return useMemo(() => (href === null ? null : new URL(href)), [href]);
}

/** The page's address at this moment, for a change made outside a render. */
export function readAddress(): URL {
  return new URL(window.location.href);
}

/** Where the history entry keeps the parameter of the overlay it opened. */
const overlayKey = "livtalesOverlay";

/**
 * Puts `url`, an address on the same page, in the address bar without a
 * navigation: `push` adds a history entry that Back returns from, `replace`
 * rewrites the current one. `overlay` names the query parameter of a dialog
 * the entry opens over the page, so closing it can step back to the page
 * (see `addressOverlay`).
 */
export function writeAddress(
  url: URL,
  mode: "push" | "replace",
  overlay?: string,
): void {
  const state = overlay === undefined ? null : { [overlayKey]: overlay };
  if (mode === "push") window.history.pushState(state, "", url);
  else window.history.replaceState(state, "", url);
  window.dispatchEvent(new Event(addressChange));
}

/**
 * The query parameter of the overlay the current history entry was pushed to
 * open, or null for an entry reached any other way (a link, a reload of a
 * shared address).
 */
export function addressOverlay(): string | null {
  const state: unknown = window.history.state;
  if (typeof state !== "object" || state === null) return null;
  const overlay: unknown = Reflect.get(state, overlayKey);
  return typeof overlay === "string" ? overlay : null;
}

/** An address on this page as a link's `href`. */
export function addressHref(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}
