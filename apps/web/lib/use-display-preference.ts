"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  displayChoices,
  displayStorageKey,
  type DisplayPreference,
  type DisplayValue,
  parseDisplayPreference,
} from "./display-preferences";

const changeEvent = "livtales:display";

function getSnapshot<K extends DisplayPreference>(name: K) {
  return parseDisplayPreference(name, document.documentElement.dataset[name]);
}

function updateBrowserChrome() {
  const canvas = getComputedStyle(document.documentElement).backgroundColor;
  const metas = document.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  for (const [index, meta] of metas.entries()) {
    meta.content = canvas;
    meta.media = index === 0 ? "all" : "not all";
  }
}

function applyPreference(name: DisplayPreference, value: unknown) {
  document.documentElement.dataset[name] = parseDisplayPreference(name, value);
  if (name === "appearance" || name === "palette") updateBrowserChrome();
}

function subscribe(name: DisplayPreference, notify: () => void) {
  applyPreference(name, getSnapshot(name));
  function onStorage(event: StorageEvent) {
    for (const key of Object.keys(displayChoices) as DisplayPreference[]) {
      if (event.key === null || event.key === displayStorageKey(key))
        applyPreference(key, event.newValue);
    }
    notify();
  }
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (name === "appearance")
    media?.addEventListener("change", updateBrowserChrome);
  window.addEventListener(changeEvent, notify);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(changeEvent, notify);
    window.removeEventListener("storage", onStorage);
    if (name === "appearance")
      media?.removeEventListener("change", updateBrowserChrome);
  };
}

function setPreference<K extends DisplayPreference>(
  name: K,
  value: DisplayValue<K>,
) {
  applyPreference(name, value);
  try {
    if (value === displayChoices[name][0])
      window.localStorage.removeItem(displayStorageKey(name));
    else window.localStorage.setItem(displayStorageKey(name), value);
  } catch {
    // Current-page preferences remain usable when persistent storage is blocked.
  }
  window.dispatchEvent(new Event(changeEvent));
}

export function resetDisplayPreferences() {
  for (const name of Object.keys(displayChoices) as DisplayPreference[])
    setPreference(name, displayChoices[name][0]);
}

export function useDisplayPreference<K extends DisplayPreference>(name: K) {
  const value = useSyncExternalStore(
    useCallback((notify) => subscribe(name, notify), [name]),
    useCallback(() => getSnapshot(name), [name]),
    () => displayChoices[name][0],
  );
  return {
    value,
    setValue: (next: DisplayValue<K>) => setPreference(name, next),
  };
}
