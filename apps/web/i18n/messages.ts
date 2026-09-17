import type { AbstractIntlMessages } from "next-intl";

import { type Locale, localeChain } from "./locales";

const catalogs: Record<Locale, () => Promise<AbstractIntlMessages>> = {
  en: () => import("../messages/en.json").then((module) => module.default),
  "zh-Hans": () =>
    import("../messages/zh-Hans.json").then((module) => module.default),
  "zh-Hant": () =>
    import("../messages/zh-Hant.json").then((module) => module.default),
};

function merge(
  base: AbstractIntlMessages,
  over: AbstractIntlMessages,
): AbstractIntlMessages {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const current = result[key];
    result[key] =
      typeof value === "object" &&
      value !== null &&
      typeof current === "object" &&
      current !== null
        ? merge(current as AbstractIntlMessages, value as AbstractIntlMessages)
        : value;
  }
  return result as AbstractIntlMessages;
}

/**
 * The messages of a locale with its fallbacks merged underneath, so a key
 * the locale lacks resolves along its chain rather than to the key itself.
 */
export async function loadMessages(
  locale: Locale,
): Promise<AbstractIntlMessages> {
  const chain = localeChain(locale);
  const loaded = await Promise.all(chain.map((tag) => catalogs[tag]()));
  // The farthest fallback is the base; nearer catalogs override it.
  return loaded.reverse().reduce((base, over) => merge(base, over), {});
}
