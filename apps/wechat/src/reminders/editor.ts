import type {
  EventContextCreatePayload,
  ReminderResponse,
  ReminderUpdatePayload,
} from "@livtales/schemas";

import {
  clockPattern,
  localParts,
  supportedTimeZone,
  WallClockError,
  zonedInstant,
} from "../events/wall-clock";

export interface ReminderEditorFields {
  readonly date: string;
  readonly displayName: string;
  readonly status: ReminderResponse["status"];
  readonly time: string;
  readonly timeZone: string;
}

export type ReminderEditorIssue =
  | "name-required"
  | "name-too-long"
  | "date-invalid"
  | "time-invalid"
  | "invalid-local-time"
  | "invalid-time-zone";

export class ReminderEditorValidationError extends Error {
  constructor(readonly issue: ReminderEditorIssue) {
    super(issue);
    this.name = "ReminderEditorValidationError";
  }
}

export function emptyReminderFields(
  timeZone: string,
  now: Date = new Date(),
): ReminderEditorFields {
  const zone = supportedTimeZone(timeZone);
  const moment = localParts(now.toISOString(), zone);
  return {
    date: moment.date,
    displayName: "",
    status: "pending",
    time: moment.time,
    timeZone: zone,
  };
}

export function fieldsFromReminder(
  reminder: ReminderResponse,
  timeZone: string,
): ReminderEditorFields {
  const zone = supportedTimeZone(timeZone);
  const moment = localParts(reminder.remindAt, zone);
  return {
    date: moment.date,
    displayName: reminder.displayName,
    status: reminder.status,
    time: moment.time,
    timeZone: zone,
  };
}

function reminderFieldsPayload(
  fields: ReminderEditorFields,
  source?: ReminderResponse,
) {
  const displayName = fields.displayName.trim();
  if (displayName.length === 0)
    throw new ReminderEditorValidationError("name-required");
  if (displayName.length > 240)
    throw new ReminderEditorValidationError("name-too-long");
  if (!clockPattern.test(fields.time))
    throw new ReminderEditorValidationError("time-invalid");

  let remindAt: string;
  try {
    const previous = source && localParts(source.remindAt, fields.timeZone);
    remindAt =
      source !== undefined &&
      previous?.date === fields.date &&
      previous.time === fields.time
        ? source.remindAt
        : zonedInstant(fields.date, fields.time, fields.timeZone);
  } catch (error) {
    if (error instanceof WallClockError)
      throw new ReminderEditorValidationError(
        error.issue === "invalid-date" ? "date-invalid" : error.issue,
      );
    throw error;
  }
  return { displayName, remindAt, status: fields.status };
}

export function reminderCreatePayload(
  fields: ReminderEditorFields,
  commandId: string,
): EventContextCreatePayload {
  return {
    commandId,
    resource: { objectType: "reminder", ...reminderFieldsPayload(fields) },
  };
}

export function reminderUpdatePayload(
  fields: ReminderEditorFields,
  source: ReminderResponse,
): ReminderUpdatePayload {
  return {
    ...reminderFieldsPayload(fields, source),
    expectedVersion: source.version,
  };
}

export function sameReminderFields(
  first: ReminderEditorFields,
  second: ReminderEditorFields,
): boolean {
  return (Object.keys(first) as (keyof ReminderEditorFields)[]).every(
    (key) => first[key] === second[key],
  );
}
