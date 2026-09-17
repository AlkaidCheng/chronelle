import {
  createTranslator,
  type Messages,
  type NamespaceKeys,
  type NestedKeyOf,
} from "next-intl";

import en from "../messages/en.json";
import { defaultLocale, type Locale } from "./locales";

/**
 * The locale and messages the client is rendering with, for the helpers
 * that word dates, durations, and counts outside React. `LocaleSync` sets
 * them from the provider; without a provider (unit tests, the sandbox
 * build) they are the default locale's.
 */
let active: { locale: Locale; messages: Messages } = {
  locale: defaultLocale,
  messages: en,
};

export function activeLocale(): Locale {
  return active.locale;
}

export function setActiveLocale(locale: Locale, messages: Messages): void {
  if (active.locale === locale && active.messages === messages) return;
  active = { locale, messages };
}

/** A translator over the active messages, for code outside React. */
export function tr<
  Namespace extends NamespaceKeys<Messages, NestedKeyOf<Messages>> = never,
>(namespace?: Namespace) {
  return createTranslator<Messages, Namespace>({
    locale: active.locale,
    messages: active.messages,
    ...(namespace === undefined ? {} : { namespace }),
  });
}
