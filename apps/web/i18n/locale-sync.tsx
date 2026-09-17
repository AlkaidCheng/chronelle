"use client";

import { useLocale, useMessages } from "next-intl";
import { useLayoutEffect } from "react";

import { setActiveLocale } from "./active-locale";
import { isLocale } from "./locales";

/**
 * Publishes the provider's locale and messages to the helpers that run
 * outside React, and keeps the document's `lang` on the same locale. In the
 * browser it sets them during render as well, so components rendered in the
 * same pass already word their dates in the right language. The server
 * shares one module across requests, so it leaves the default there; the
 * surfaces that call those helpers render after hydration.
 */
export function LocaleSync() {
  const locale = useLocale();
  const messages = useMessages();
  if (typeof window !== "undefined" && isLocale(locale))
    setActiveLocale(locale, messages);
  useLayoutEffect(() => {
    if (!isLocale(locale)) return;
    setActiveLocale(locale, messages);
    document.documentElement.lang = locale;
  }, [locale, messages]);
  return null;
}
