"use client";

import { createShortcutPreference } from "./shortcut-preference";

export const componentShortcuts = {
  slash: { label: "/", keys: "/" },
  "modified-slash": { label: "Cmd/Ctrl + /", keys: "Control+/ Meta+/" },
  disabled: { label: "Off", keys: undefined },
} as const;
type ComponentShortcut = keyof typeof componentShortcuts;

export function parseComponentShortcut(value: unknown): ComponentShortcut {
  return value === "modified-slash" || value === "disabled" ? value : "slash";
}

export const useComponentShortcut = createShortcutPreference(
  "component",
  parseComponentShortcut,
  "slash",
  "disabled",
);
