"use client";

import { useSyncExternalStore } from "react";

/**
 * The media query that stands for a device with a keyboard: a fine pointer
 * that can hover. Shortcut symbols and the keyboard settings show only
 * there; a touch phone shows none, while the shortcuts stay bound.
 */
export const keyboardDeviceQuery = "(hover: hover) and (pointer: fine)";

function subscribe(notify: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(keyboardDeviceQuery);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

function snapshot() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(keyboardDeviceQuery).matches
  );
}

/** Whether the viewer's device has a keyboard; false on the server and until hydration. */
export function useKeyboardDevice(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
