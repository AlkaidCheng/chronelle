/**
 * The languages the web app speaks. Adding one is a catalog file under
 * `messages/` plus an entry here; the Language control, the negotiation,
 * the `lang` attribute, the formatting helpers, and the completeness test
 * all read this list.
 */
export interface LocaleDefinition {
  /** The BCP 47 tag, also the catalog's file name. */
  readonly tag: string;
  /** The language's name in itself, as the Language control shows it. */
  readonly native: string;
  /** Where a missing message is looked up next, nearest first. */
  readonly fallbacks: readonly string[];
  /**
   * The day the week starts on when the account has not chosen one: 1 for
   * Monday, 7 for Sunday, as CLDR gives the language's main region. Fixed
   * here rather than asked of the browser so every engine agrees.
   */
  readonly weekStart: 1 | 7;
}

export const locales = [
  { tag: "en", native: "English", fallbacks: [], weekStart: 7 },
  { tag: "zh-Hans", native: "简体中文", fallbacks: ["en"], weekStart: 1 },
  {
    tag: "zh-Hant",
    native: "繁體中文",
    fallbacks: ["zh-Hans", "en"],
    weekStart: 7,
  },
] as const satisfies readonly LocaleDefinition[];

export type Locale = (typeof locales)[number]["tag"];

/** The first day of the week the language implies, when no day is chosen. */
export function languageWeekStart(locale: string): 1 | 7 {
  return (
    locales.find((entry) => entry.tag === locale)?.weekStart ??
    locales[0].weekStart
  );
}

export const defaultLocale: Locale = "en";

/** The cookie that carries an explicit choice; absent means the browser's. */
export const localeCookie = "chronelle.locale";

/** The localStorage key mirroring the cookie for the same browser. */
export const localeStorageKey = "chronelle.locale";

export function isLocale(value: unknown): value is Locale {
  return locales.some((locale) => locale.tag === value);
}

/**
 * The locale the app speaks for one browser tag: Traditional Chinese for the
 * Hant script and the regions that write it, Simplified for the rest of
 * Chinese, English for English; undefined for anything else.
 */
function localeForTag(tag: string): Locale | undefined {
  const lower = tag.toLowerCase();
  const [language, ...rest] = lower.split("-");
  if (language === "zh") {
    if (rest.some((part) => ["hant", "tw", "hk", "mo"].includes(part)))
      return "zh-Hant";
    return "zh-Hans";
  }
  if (language === "en") return "en";
  return undefined;
}

/**
 * The locale for a list of browser tags in order of preference, the first
 * that maps; the default when none does.
 */
export function negotiateLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const locale = localeForTag(tag.trim());
    if (locale !== undefined) return locale;
  }
  return defaultLocale;
}

/** The tags of an Accept-Language header, most preferred first. */
export function acceptedLanguages(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const quality = params
        .map((param) => /^\s*q=([0-9.]+)/.exec(param)?.[1])
        .find((value) => value !== undefined);
      return { tag, quality: quality === undefined ? 1 : Number(quality) };
    })
    .filter(({ tag, quality }) => tag !== "" && tag !== "*" && quality > 0)
    .sort((a, b) => b.quality - a.quality)
    .map(({ tag }) => tag);
}

/** The full fallback chain of a locale, the locale itself first. */
export function localeChain(locale: Locale): readonly Locale[] {
  const definition = locales.find((entry) => entry.tag === locale);
  return [locale, ...(definition?.fallbacks ?? [])] as Locale[];
}
