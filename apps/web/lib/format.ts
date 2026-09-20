import { activeLocale, tr } from "../i18n/active-locale";
import { instantOptions } from "../i18n/active-preferences";
import { instantDayKey, instantWallInput, wallInstant } from "./zone";

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const nameCollators = new Map<string, Intl.Collator>();

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions) {
  // Device-default formatters must follow system timezone changes.
  if (options.timeZone === undefined)
    return new Intl.DateTimeFormat(locale, options);
  const key = JSON.stringify([locale, options]);
  let format = dateFormats.get(key);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, options);
    if (dateFormats.size >= 48) dateFormats.clear();
    dateFormats.set(key, format);
  }
  return format;
}

/** An instant as the wall clock of the active zone, for a datetime-local field. */
export function toDateTimeInput(value: string | null): string {
  if (value === null) {
    return "";
  }
  return instantWallInput(value);
}

/** The instant a datetime-local value names in the active zone; null when empty. */
export function fromDateTimeInput(value: string): string | null {
  if (value === "") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value,
  );
  if (match === null) return new Date(value).toISOString();
  return wallInstant({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  }).toISOString();
}

/** A date and time in the active locale and zone; "Not scheduled" without one. */
export function formatDateTime(
  value: string | null,
  locale: string = activeLocale(),
): string {
  if (value === null) return tr("dates")("notScheduled");
  return dateFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...instantOptions(),
  }).format(new Date(value));
}

export function formatTime(
  value: string,
  locale: string = activeLocale(),
): string {
  return dateFormat(locale, {
    timeStyle: "short",
    ...instantOptions(),
  }).format(new Date(value));
}

/**
 * A moment as a ledger reads it: "Today, 09:12" or "Yesterday, 18:40" for
 * the last two days, otherwise the day with its time ("Sep 12, 21:05"),
 * and the year only when it is not the current one.
 */
export function formatMoment(
  value: string,
  locale: string = activeLocale(),
  now: Date = new Date(),
): string {
  const t = tr("dates");
  const day = instantDayKey(value);
  const today = instantDayKey(now);
  const yesterday = instantDayKey(new Date(now.getTime() - 86_400_000));
  if (day === today || day === yesterday)
    return t("moment", {
      day: t(day === today ? "today" : "yesterday"),
      time: formatTime(value, locale),
    });
  return dateFormat(locale, {
    month: "short",
    day: "numeric",
    ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
    ...instantOptions(),
  }).format(new Date(value));
}

/** A duration in minutes as people read it: "30 min", "1 h", "1 h 30 min". */
export function formatDuration(minutes: number): string {
  const t = tr("dates.duration");
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t("minutes", { minutes: rest });
  return rest === 0
    ? t("hours", { hours })
    : t("hoursMinutes", { hours, minutes: rest });
}

export function formatDatePart(
  value: string | null,
  part: "month" | "day",
  locale: string = activeLocale(),
): string {
  if (value === null) return tr("dates")(part === "month" ? "tbd" : "noDay");
  return dateFormat(locale, {
    ...(part === "month" ? { month: "short" } : { day: "2-digit" }),
    ...instantOptions(),
  }).format(new Date(value));
}

export function shortId(id: string): string {
  return id.slice(-8);
}

export function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Orders two names the way the active language reads them (Chinese by
 * pinyin under zh-Hans and by stroke under zh-Hant, as ICU defines), case
 * and accent aside.
 */
export function compareNames(a: string, b: string): number {
  const locale = activeLocale();
  let collator = nameCollators.get(locale);
  if (collator === undefined) {
    collator = new Intl.Collator(locale, { sensitivity: "base" });
    nameCollators.set(locale, collator);
  }
  return collator.compare(a, b);
}
