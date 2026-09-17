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

/** The choice this browser holds: the cookie's language, or "system". */
export function readLocaleChoice(): LocaleChoice {
  const match = new RegExp(`(?:^|; )${localeCookie}=([^;]*)`).exec(
    document.cookie,
  );
  const value = match?.[1];
  return isLocale(value) ? value : "system";
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

function subscribe(notify: () => void) {
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
    subscribe,
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
