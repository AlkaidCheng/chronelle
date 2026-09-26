"use client";

import {
  addressHref,
  addressOverlay,
  readAddress,
  useAddress,
  writeAddress,
} from "./location-store";

/** The sections of Settings, in the order its list shows them. */
const settingsSections = [
  "general",
  "language",
  "appearance",
  "keyboard",
  "members",
] as const;

export type SettingsSection = (typeof settingsSections)[number];

/**
 * The query parameter that opens Settings over the page at one of its
 * sections: `/events/<id>?view=todos&settings=language` is the event's
 * To-dos with Settings open on Language & time.
 */
const parameter = "settings";

/** The section `value` names, or null for anything else. */
export function parseSettingsSection(
  value: string | null | undefined,
): SettingsSection | null {
  return settingsSections.find((section) => section === value) ?? null;
}

function withSection(address: URL, section: SettingsSection | null): URL {
  const url = new URL(address);
  if (section === null) url.searchParams.delete(parameter);
  else url.searchParams.set(parameter, section);
  return url;
}

/** The section of Settings the address opens over the page, or null. */
export function useSettingsSection(): SettingsSection | null {
  return parseSettingsSection(useAddress()?.searchParams.get(parameter));
}

/**
 * The address of the page at `address` with Settings open at `section`;
 * Events before the page's address is known.
 */
export function settingsHref(
  address: URL | null,
  section: SettingsSection,
): string {
  return addressHref(
    withSection(
      address ?? new URL("/events", "https://livtales.invalid"),
      section,
    ),
  );
}

/**
 * Opens Settings at `section` over the current page as a history entry of
 * its own, so Back closes it.
 */
export function openSettings(section: SettingsSection): void {
  writeAddress(withSection(readAddress(), section), "push", parameter);
}

/** Shows another section in place; moving between sections adds no history. */
export function showSettingsSection(section: SettingsSection): void {
  const overlay = addressOverlay();
  writeAddress(
    withSection(readAddress(), section),
    "replace",
    overlay === parameter ? parameter : undefined,
  );
}

/** Set while a step back is on its way, so a second close does not step twice. */
let steppingBack = false;

/**
 * Closes Settings and returns to the page under it: back through history
 * when opening it added the entry, else by taking the section out of the
 * address in place (Settings reached by a link or a reload).
 */
export function closeSettings(): void {
  const address = readAddress();
  if (steppingBack || !address.searchParams.has(parameter)) return;
  if (addressOverlay() !== parameter) {
    writeAddress(withSection(address, null), "replace");
    return;
  }
  steppingBack = true;
  window.addEventListener(
    "popstate",
    () => {
      steppingBack = false;
    },
    { once: true },
  );
  window.history.back();
}
