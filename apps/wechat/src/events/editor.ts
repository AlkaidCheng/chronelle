import {
  calendarDateSchema,
  type EventCreatePayload,
  type EventResponse,
  type EventUpdatePayload,
} from "@chronelle/schemas";

export type EventScheduleMode = "undated" | "dates" | "timed";

export interface EventEditorFields {
  readonly description: string;
  readonly displayName: string;
  readonly endDate: string;
  readonly endTime: string;
  readonly location: string;
  readonly mode: EventScheduleMode;
  readonly startDate: string;
  readonly startTime: string;
  readonly timeZone: string;
}

export type EventEditorIssue =
  | "description-too-long"
  | "end-before-start"
  | "end-incomplete"
  | "invalid-date"
  | "invalid-local-time"
  | "invalid-time-zone"
  | "location-too-long"
  | "name-required"
  | "name-too-long"
  | "start-required";

export class EventEditorValidationError extends Error {
  readonly issue: EventEditorIssue;

  constructor(issue: EventEditorIssue) {
    super(issue);
    this.name = "EventEditorValidationError";
    this.issue = issue;
  }
}

const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function localCalendarDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function emptyEventFields(
  timeZone: string,
  now: Date = new Date(),
): EventEditorFields {
  return {
    description: "",
    displayName: "",
    endDate: "",
    endTime: "",
    location: "",
    mode: "undated",
    startDate: localCalendarDate(now),
    startTime: "09:00",
    timeZone,
  };
}

function localParts(value: string, timeZone: string) {
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

function supportedTimeZone(preferred: string, fallback = "UTC"): string {
  for (const candidate of [preferred, fallback, "UTC"]) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
      return candidate;
    } catch {
      // Try the account or UTC fallback when a device lacks this zone.
    }
  }
  return "UTC";
}

export function fieldsFromEvent(
  event: EventResponse,
  fallbackTimeZone: string,
): EventEditorFields {
  const timeZone = supportedTimeZone(
    event.timezone ?? fallbackTimeZone,
    fallbackTimeZone,
  );
  const start = event.startsAt
    ? localParts(event.startsAt, timeZone)
    : { date: localCalendarDate(), time: "09:00" };
  const end = event.endsAt
    ? localParts(event.endsAt, timeZone)
    : { date: "", time: "" };
  return {
    description: event.description ?? "",
    displayName: event.displayName,
    endDate: event.endsOn ?? end.date,
    endTime: end.time,
    location: event.location ?? "",
    mode: event.startsOn ? "dates" : event.startsAt ? "timed" : "undated",
    startDate: event.startsOn ?? start.date,
    startTime: start.time,
    timeZone,
  };
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

function zonedInstant(
  dateValue: string,
  timeValue: string,
  timeZone: string,
): string {
  const date = dateParts(dateValue);
  const time = timeParts(timeValue);
  if (date === null || time === null)
    throw new EventEditorValidationError("invalid-date");

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
        throw new EventEditorValidationError("invalid-local-time");
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
      throw new EventEditorValidationError("invalid-local-time");
  } catch (error) {
    if (error instanceof EventEditorValidationError) throw error;
    throw new EventEditorValidationError("invalid-time-zone");
  }
  return new Date(instant).toISOString();
}

function sharedPayload(fields: EventEditorFields) {
  const displayName = fields.displayName.trim();
  const description = fields.description.trim();
  const location = fields.location.trim();
  if (displayName.length === 0)
    throw new EventEditorValidationError("name-required");
  if (displayName.length > 240)
    throw new EventEditorValidationError("name-too-long");
  if (description.length > 2_000)
    throw new EventEditorValidationError("description-too-long");
  if (location.length > 240)
    throw new EventEditorValidationError("location-too-long");
  return {
    description: description || null,
    displayName,
    location: location || null,
  };
}

function schedulePayload(fields: EventEditorFields) {
  const cleared = {
    endsAt: null,
    endsOn: null,
    isAllDay: false,
    startsAt: null,
    startsOn: null,
    timezone: null,
  } as const;
  if (fields.mode === "undated") return cleared;
  if (dateParts(fields.startDate) === null)
    throw new EventEditorValidationError(
      fields.startDate.length === 0 ? "start-required" : "invalid-date",
    );
  if (fields.endDate && dateParts(fields.endDate) === null)
    throw new EventEditorValidationError("invalid-date");
  if (fields.endDate && fields.endDate < fields.startDate)
    throw new EventEditorValidationError("end-before-start");
  if (fields.mode === "dates") {
    return {
      ...cleared,
      endsOn: fields.endDate || null,
      isAllDay: true,
      startsOn: fields.startDate,
    };
  }
  if (!clockPattern.test(fields.startTime))
    throw new EventEditorValidationError("start-required");
  if (Boolean(fields.endDate) !== Boolean(fields.endTime))
    throw new EventEditorValidationError("end-incomplete");
  const startsAt = zonedInstant(
    fields.startDate,
    fields.startTime,
    fields.timeZone,
  );
  const endsAt = fields.endDate
    ? zonedInstant(fields.endDate, fields.endTime, fields.timeZone)
    : null;
  if (endsAt !== null && endsAt < startsAt)
    throw new EventEditorValidationError("end-before-start");
  return {
    ...cleared,
    endsAt,
    startsAt,
    timezone: fields.timeZone,
  };
}

export function eventCreatePayload(
  fields: EventEditorFields,
  commandId: string,
): EventCreatePayload {
  return {
    ...sharedPayload(fields),
    ...schedulePayload(fields),
    commandId,
  };
}

export function eventUpdatePayload(
  fields: EventEditorFields,
  expectedVersion: number,
): EventUpdatePayload {
  return {
    ...sharedPayload(fields),
    ...schedulePayload(fields),
    expectedVersion,
  };
}

export function sameEventFields(
  first: EventEditorFields,
  second: EventEditorFields,
): boolean {
  return (Object.keys(first) as (keyof EventEditorFields)[]).every(
    (key) => first[key] === second[key],
  );
}
