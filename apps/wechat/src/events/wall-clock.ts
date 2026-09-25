import { calendarDateSchema } from "@livtales/schemas";

export type WallClockIssue =
  "invalid-date" | "invalid-local-time" | "invalid-time-zone";

export class WallClockError extends Error {
  readonly issue: WallClockIssue;

  constructor(issue: WallClockIssue) {
    super(issue);
    this.name = "WallClockError";
    this.issue = issue;
  }
}

export const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function localCalendarDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function deviceTimeZone(fallback: string | null): string {
  try {
    return (
      Intl.DateTimeFormat().resolvedOptions().timeZone || fallback || "UTC"
    );
  } catch {
    return fallback || "UTC";
  }
}

export function localParts(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(value));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.get("year")}-${values.get("month")}-${values.get("day")}`,
    time: `${values.get("hour")}:${values.get("minute")}`,
  };
}

export function supportedTimeZone(preferred: string, fallback = "UTC"): string {
  for (const candidate of [preferred, fallback, "UTC"]) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
      return candidate;
    } catch {
      // Continue with the account or UTC fallback.
    }
  }
  return "UTC";
}

function dateParts(value: string): [number, number, number] | null {
  if (!calendarDateSchema.safeParse(value).success) return null;
  const parts = value.split("-").map(Number);
  return parts.length === 3
    ? [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
    : null;
}

function timeParts(value: string): [number, number] | null {
  if (!clockPattern.test(value)) return null;
  const parts = value.split(":").map(Number);
  return parts.length === 2 ? [parts[0] ?? 0, parts[1] ?? 0] : null;
}

/** Resolves a calendar date and wall-clock time in an IANA time zone. */
export function zonedInstant(
  dateValue: string,
  timeValue: string,
  timeZone: string,
): string {
  const date = dateParts(dateValue);
  const time = timeParts(timeValue);
  if (date === null || time === null) throw new WallClockError("invalid-date");

  const [year, month, day] = date;
  const [hour, minute] = time;
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let instant = target;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const observed = localParts(new Date(instant).toISOString(), timeZone);
      const observedDate = dateParts(observed.date);
      const observedTime = timeParts(observed.time);
      if (observedDate === null || observedTime === null)
        throw new WallClockError("invalid-local-time");
      instant +=
        target -
        Date.UTC(
          observedDate[0],
          observedDate[1] - 1,
          observedDate[2],
          observedTime[0],
          observedTime[1],
        );
    }
    const resolved = localParts(new Date(instant).toISOString(), timeZone);
    if (resolved.date !== dateValue || resolved.time !== timeValue)
      throw new WallClockError("invalid-local-time");
  } catch (error) {
    if (error instanceof WallClockError) throw error;
    throw new WallClockError("invalid-time-zone");
  }
  return new Date(instant).toISOString();
}
