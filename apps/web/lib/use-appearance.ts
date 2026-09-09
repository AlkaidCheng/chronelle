"use client";

import { useSyncExternalStore } from "react";
import {
  type Appearance,
  appearanceStorageKey,
  parseAppearance,
} from "./appearance-preference";

const changeEvent = "chronelle:appearance";

function getSnapshot(): Appearance {
  return parseAppearance(document.documentElement.dataset.appearance);
}

function applyAppearance(appearance: Appearance) {
  document.documentElement.dataset.appearance = appearance;
  for (const meta of document.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  )) {
    meta.dataset.systemMedia ??= meta.media;
    const systemMedia = meta.dataset.systemMedia;
    meta.media =
      appearance === "system"
        ? systemMedia
        : systemMedia.includes(`: ${appearance})`)
          ? "all"
          : "not all";
  }
}

function subscribe(notify: () => void) {
  applyAppearance(getSnapshot());
  function onStorage(event: StorageEvent) {
    if (event.key !== null && event.key !== appearanceStorageKey) return;
    applyAppearance(parseAppearance(event.newValue));
    notify();
  }
  window.addEventListener(changeEvent, notify);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(changeEvent, notify);
    window.removeEventListener("storage", onStorage);
  };
}

function setAppearance(appearance: Appearance) {
  applyAppearance(appearance);
  try {
    if (appearance === "system")
      window.localStorage.removeItem(appearanceStorageKey);
    else window.localStorage.setItem(appearanceStorageKey, appearance);
  } catch {
    // The current page can change appearance when persistent storage is blocked.
  }
  window.dispatchEvent(new Event(changeEvent));
}

export function useAppearance() {
  const appearance = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => "system",
  );
  return { appearance, setAppearance };
}
