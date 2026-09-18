/**
 * A moment as words relative to now ("3 hours ago", "in 2 days") in the
 * given locale, choosing the largest unit that keeps the count above one.
 */
export function formatRelativeTime(
  iso: string,
  locale: string,
  now: Date = new Date(),
): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const units: readonly [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size)
      return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "second");
}
