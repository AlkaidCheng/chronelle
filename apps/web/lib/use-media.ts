"use client";

import { useCallback, useSyncExternalStore } from "react";

/** The narrow layout: the sidebar becomes the bottom bar and the app bar takes the top. */
export const phoneQuery = "(max-width: 760px)";

/**
 * Whether a media query matches, following it as the viewport changes;
 * false until the page is on the client.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia(query).matches,
    () => false,
  );
}

export function useIsPhone(): boolean {
  return useMediaQuery(phoneQuery);
}
