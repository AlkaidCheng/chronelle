import { activeLocale, tr } from "../i18n/active-locale";

export function toDateTimeInput(value: string | null): string {
  if (value === null) {
    return "";
  }
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function fromDateTimeInput(value: string): string | null {
  return value === "" ? null : new Date(value).toISOString();
}

/** A date and time in the active locale; "Not scheduled" without one. */
export function formatDateTime(
  value: string | null,
  locale: string = activeLocale(),
): string {
  if (value === null) return tr("dates")("notScheduled");
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatTime(
  value: string,
  locale: string = activeLocale(),
): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(
    new Date(value),
  );
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
  return new Intl.DateTimeFormat(
    locale,
    part === "month" ? { month: "short" } : { day: "2-digit" },
  ).format(new Date(value));
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
