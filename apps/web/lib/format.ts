import { activeLocale, tr } from "../i18n/active-locale";
import { instantOptions } from "../i18n/active-preferences";
import { instantWallInput, wallInstant } from "./zone";

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
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...instantOptions(),
  }).format(new Date(value));
}

export function formatTime(
  value: string,
  locale: string = activeLocale(),
): string {
  return new Intl.DateTimeFormat(locale, {
    timeStyle: "short",
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
  return new Intl.DateTimeFormat(locale, {
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
  return a.localeCompare(b, activeLocale(), { sensitivity: "base" });
}
