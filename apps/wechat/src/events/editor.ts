import {
  calendarDateSchema,
  type EventCreatePayload,
  type EventResponse,
  type EventUpdatePayload,
} from "@chronelle/schemas";

import {
  clockPattern,
  localCalendarDate,
  localParts,
  supportedTimeZone,
  WallClockError,
  zonedInstant,
} from "./wall-clock";

export { localCalendarDate } from "./wall-clock";

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
  if (!calendarDateSchema.safeParse(fields.startDate).success)
    throw new EventEditorValidationError(
      fields.startDate.length === 0 ? "start-required" : "invalid-date",
    );
  if (fields.endDate && !calendarDateSchema.safeParse(fields.endDate).success)
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
  let startsAt: string;
  let endsAt: string | null;
  try {
    startsAt = zonedInstant(
      fields.startDate,
      fields.startTime,
      fields.timeZone,
    );
    endsAt = fields.endDate
      ? zonedInstant(fields.endDate, fields.endTime, fields.timeZone)
      : null;
  } catch (error) {
    if (error instanceof WallClockError)
      throw new EventEditorValidationError(error.issue);
    throw error;
  }
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
