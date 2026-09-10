"use client";

import { useSyncExternalStore } from "react";

export function createShortcutPreference<Value extends string>(
  name: string,
  parse: (value: unknown) => Value,
  defaultValue: Value,
  serverValue: Value,
) {
  const storageKey = `chronelle.${name}-shortcut`;
  const changeEvent = `chronelle:${name}-shortcut`;
  const attribute = `data-${name}-shortcut`;

  function snapshot(): Value {
    const transient = document.documentElement.getAttribute(attribute);
    if (transient !== null) return parse(transient);
    try {
      return parse(window.localStorage.getItem(storageKey));
    } catch {
      return defaultValue;
    }
  }

  function subscribe(notify: () => void) {
    function synchronize(event: StorageEvent) {
      try {
        if (event.storageArea !== window.localStorage) return;
      } catch {
        return;
      }
      if (event.key === null || event.key === storageKey) {
        document.documentElement.removeAttribute(attribute);
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

  function setValue(value: Value) {
    try {
      if (value === defaultValue) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, value);
      document.documentElement.removeAttribute(attribute);
    } catch {
      // Retain a current-page preference when browser storage is unavailable.
      document.documentElement.setAttribute(attribute, value);
    }
    window.dispatchEvent(new Event(changeEvent));
  }

  return function useShortcutPreference() {
    const value = useSyncExternalStore(subscribe, snapshot, () => serverValue);
    return { value, setValue };
  };
}

function parseToggle(value: unknown) {
  return value === "disabled" ? "disabled" : "enabled";
}

export const useCommandShortcut = createShortcutPreference(
  "command",
  parseToggle,
  "enabled",
  "disabled",
);
