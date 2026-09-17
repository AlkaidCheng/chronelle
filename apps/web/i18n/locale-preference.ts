"use client";

import { useRouter } from "next/navigation";
import { useCallback, useSyncExternalStore } from "react";

import {
  isLocale,
  type Locale,
  localeCookie,
  localeStorageKey,
} from "./locales";

export { isLocale };

/** An explicit language, or "system" for the browser's. */
export type LocaleChoice = Locale | "system";

const changeEvent = "chronelle:locale";
const yearInSeconds = 60 * 60 * 24 * 365;

/** The choice the localStorage mirror holds; "system" when there is none. */
function readMirroredLocaleChoice(): LocaleChoice {
  try {
    const value = window.localStorage.getItem(localeStorageKey);
    return isLocale(value) ? value : "system";
  } catch {
    return "system";
  }
}

/**
 * The choice this browser holds: the cookie's language, or "system". A page
 * opened from a file has no cookies, so there the storage mirror carries the
 * choice (the offline sandbox).
 */
export function readLocaleChoice(): LocaleChoice {
  const match = new RegExp(`(?:^|; )${localeCookie}=([^;]*)`).exec(
    document.cookie,
  );
  const value = match?.[1];
  if (isLocale(value)) return value;
  return window.location.protocol === "file:"
    ? readMirroredLocaleChoice()
    : "system";
}

function writeCookie(choice: LocaleChoice) {
  const base = `${localeCookie}=${choice === "system" ? "" : choice}; Path=/; SameSite=Lax`;
  // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is async and not in every supported browser
  document.cookie =
    choice === "system"
      ? `${base}; Max-Age=0`
      : `${base}; Max-Age=${yearInSeconds}`;
}

function writeStorage(choice: LocaleChoice) {
  try {
    if (choice === "system") window.localStorage.removeItem(localeStorageKey);
    else window.localStorage.setItem(localeStorageKey, choice);
  } catch {
    // The cookie alone carries the choice when storage is blocked.
  }
}

/**
 * Records a choice in this browser (the cookie and its mirror) and tells
 * the hooks; the caller refreshes the router so the server re-renders in
 * the new language.
 */
export function writeLocaleChoice(choice: LocaleChoice): void {
  writeCookie(choice);
  writeStorage(choice);
  window.dispatchEvent(new Event(changeEvent));
}

/** The account's language as a choice: a known locale, else "system". */
export function localeChoiceOf(locale: string | null): LocaleChoice {
  return isLocale(locale) ? locale : "system";
}

/** Calls `notify` whenever this browser's language choice is written. */
export function subscribeLocaleChoice(notify: () => void) {
  window.addEventListener(changeEvent, notify);
  return () => window.removeEventListener(changeEvent, notify);
}

/**
 * The language choice of this browser: the cookie the server reads, with a
 * localStorage mirror. Choosing re-renders the app in place through a
 * router refresh; nothing reloads.
 */
export function useLocaleChoice() {
  const router = useRouter();
  const choice = useSyncExternalStore(
    subscribeLocaleChoice,
    readLocaleChoice,
    () => "system" as LocaleChoice,
  );
  const setChoice = useCallback(
    (next: LocaleChoice) => {
      writeLocaleChoice(next);
      router.refresh();
    },
    [router],
  );
  return { choice, setChoice };
}
