import { activeTimeZone } from "../i18n/active-preferences";

/** A wall-clock reading: the calendar fields of an instant in one zone. */
export interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const readers = new Map<string, Intl.DateTimeFormat>();

function reader(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? "";
  let format = readers.get(key);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-US", {
      ...(timeZone === undefined ? {} : { timeZone }),
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    readers.set(key, format);
  }
  return format;
}

/** The wall clock of an instant in the zone (the device's when none). */
export function wallClock(
  instant: Date,
  timeZone: string | undefined = activeTimeZone(),
): WallClock {
  if (Number.isNaN(instant.getTime()))
    throw new RangeError("Invalid time value");
  if (timeZone === undefined)
    return {
      year: instant.getFullYear(),
      month: instant.getMonth() + 1,
      day: instant.getDate(),
      hour: instant.getHours(),
      minute: instant.getMinutes(),
      second: instant.getSeconds(),
    };
  const fields: Record<string, number> = {};
  for (const part of reader(timeZone).formatToParts(instant))
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  return {
    year: fields.year ?? 0,
    month: fields.month ?? 1,
    day: fields.day ?? 1,
    // Some engines read midnight as 24 even on an h23 cycle.
    hour: (fields.hour ?? 0) % 24,
    minute: fields.minute ?? 0,
    second: fields.second ?? 0,
  };
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** The calendar day of an instant in the zone, as YYYY-MM-DD. */
export function instantDayKey(
  instant: Date | string,
  timeZone: string | undefined = activeTimeZone(),
): string {
  const wall = wallClock(
    typeof instant === "string" ? new Date(instant) : instant,
    timeZone,
  );
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** The instant's wall clock as a datetime-local value, YYYY-MM-DDTHH:mm. */
export function instantWallInput(
  instant: Date | string,
  timeZone: string | undefined = activeTimeZone(),
): string {
  const wall = wallClock(
    typeof instant === "string" ? new Date(instant) : instant,
    timeZone,
  );
  return `${instantDayKey(instant, timeZone)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

/**
 * The instant a wall clock names in the zone (the device's when none). A
 * time the clock skips is read after the change, as the device's Date does;
 * a time it repeats is read at its first occurrence.
 */
export function wallInstant(
  wall: Pick<WallClock, "year" | "month" | "day" | "hour" | "minute"> &
    Partial<Pick<WallClock, "second">>,
  timeZone: string | undefined = activeTimeZone(),
): Date {
  const second = wall.second ?? 0;
  if (timeZone === undefined)
    return new Date(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      second,
    );
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    second,
  );
  // Two rounds settle on the offset in force at the instant itself, which
  // differs from the first guess only across a clock change.
  let instant = asUtc;
  for (let round = 0; round < 2; round += 1) {
    const read = wallClock(new Date(instant), timeZone);
    const readAsUtc = Date.UTC(
      read.year,
      read.month - 1,
      read.day,
      read.hour,
      read.minute,
      read.second,
    );
    instant += asUtc - readAsUtc;
  }
  return new Date(instant);
}

/** Whether Intl knows the zone by this name. */
export function isKnownTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** The zone's offset from UTC at the instant, as "UTC+08:00" or "UTC-03:30". */
export function zoneOffsetLabel(
  timeZone: string,
  instant: Date = new Date(),
): string {
  const wall = wallClock(instant, timeZone);
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  const minutes = Math.round(
    (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000,
  );
  const sign = minutes < 0 ? "-" : "+";
  const magnitude = Math.abs(minutes);
  return `UTC${sign}${pad(Math.floor(magnitude / 60))}:${pad(magnitude % 60)}`;
}
