"use client";

import { useSyncExternalStore } from "react";

export const componentShortcuts = {
  slash: { label: "/", keys: "/" },
  "modified-slash": { label: "Cmd/Ctrl + /", keys: "Control+/ Meta+/" },
  disabled: { label: "Off", keys: undefined },
} as const;
type ComponentShortcut = keyof typeof componentShortcuts;
const storageKey = "chronelle.component-shortcut";
const changeEvent = "chronelle:component-shortcut";

export function parseComponentShortcut(value: unknown): ComponentShortcut {
  return value === "modified-slash" || value === "disabled" ? value : "slash";
}

function snapshot() {
  const transient = document.documentElement.dataset.componentShortcut;
  if (transient !== undefined) return parseComponentShortcut(transient);
  try {
    return parseComponentShortcut(window.localStorage.getItem(storageKey));
  } catch {
    return "slash" as const;
  }
}

function subscribe(notify: () => void) {
  const root = document.documentElement;
  function synchronize(event: StorageEvent) {
    try {
      if (event.storageArea !== window.localStorage) return;
    } catch {
      return;
    }
    if (event.key === null || event.key === storageKey) {
      delete root.dataset.componentShortcut;
      notify();
    }
  }
  window.addEventListener(changeEvent, notify);
  window.addEventListener("storage", synchronize);
  return () => {
    window.removeEventListener(changeEvent, notify);
    window.removeEventListener("storage", synchronize);
  };
}

function setValue(value: ComponentShortcut) {
  try {
    if (value === "slash") window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, value);
    delete document.documentElement.dataset.componentShortcut;
  } catch {
    // All mounted consumers retain the choice even when persistence fails.
    document.documentElement.dataset.componentShortcut = value;
  }
  window.dispatchEvent(new Event(changeEvent));
}

export function useComponentShortcut() {
  const value = useSyncExternalStore<ComponentShortcut>(
    subscribe,
    snapshot,
    () => "disabled",
  );
  return { value, setValue };
}
