import {
  calendarDateSchema,
  type EventContextCreatePayload,
  type TaskResponse,
  type TaskUpdatePayload,
} from "@chronelle/schemas";

import {
  clockPattern,
  localCalendarDate,
  localParts,
  supportedTimeZone,
  WallClockError,
  zonedInstant,
} from "../events/wall-clock";

export type TaskDueMode = "undated" | "date" | "timed";

export interface TaskEditorFields {
  readonly description: string;
  readonly displayName: string;
  readonly dueDate: string;
  readonly dueTime: string;
  readonly location: string;
  readonly mode: TaskDueMode;
  readonly sectionId: string | null;
  readonly status: TaskResponse["status"];
  readonly timeZone: string;
}

export type TaskEditorIssue =
  | "description-too-long"
  | "due-date-required"
  | "due-time-required"
  | "invalid-date"
  | "invalid-local-time"
  | "invalid-time-zone"
  | "location-too-long"
  | "name-required"
  | "name-too-long";

export class TaskEditorValidationError extends Error {
  readonly issue: TaskEditorIssue;

  constructor(issue: TaskEditorIssue) {
    super(issue);
    this.name = "TaskEditorValidationError";
    this.issue = issue;
  }
}

export function emptyTaskFields(
  timeZone: string,
  sectionId: string | null = null,
  now: Date = new Date(),
): TaskEditorFields {
  return {
    description: "",
    displayName: "",
    dueDate: localCalendarDate(now),
    dueTime: "09:00",
    location: "",
    mode: "undated",
    sectionId,
    status: "todo",
    timeZone: supportedTimeZone(timeZone),
  };
}

export function fieldsFromTask(
  task: TaskResponse,
  fallbackTimeZone: string,
): TaskEditorFields {
  const timeZone = supportedTimeZone(fallbackTimeZone);
  const timed = task.dueAt ? localParts(task.dueAt, timeZone) : null;
  return {
    description: task.description ?? "",
    displayName: task.displayName,
    dueDate: task.dueOn ?? timed?.date ?? localCalendarDate(),
    dueTime: timed?.time ?? "09:00",
    location: task.location ?? "",
    mode: task.dueOn ? "date" : task.dueAt ? "timed" : "undated",
    sectionId: task.sectionId,
    status: task.status,
    timeZone,
  };
}

function contentPayload(fields: TaskEditorFields) {
  const displayName = fields.displayName.trim();
  const description = fields.description.trim();
  const location = fields.location.trim();
  if (displayName.length === 0)
    throw new TaskEditorValidationError("name-required");
  if (displayName.length > 240)
    throw new TaskEditorValidationError("name-too-long");
  if (description.length > 2_000)
    throw new TaskEditorValidationError("description-too-long");
  if (location.length > 240)
    throw new TaskEditorValidationError("location-too-long");
  return {
    description: description || null,
    displayName,
    location: location || null,
    sectionId: fields.sectionId,
  };
}

function schedulePayload(fields: TaskEditorFields) {
  if (fields.mode === "undated") {
    return {
      dueAt: null,
      dueOn: null,
      durationMinutes: null,
      repeatRule: null,
      repeatUntil: null,
    } as const;
  }
  if (!calendarDateSchema.safeParse(fields.dueDate).success)
    throw new TaskEditorValidationError(
      fields.dueDate.length === 0 ? "due-date-required" : "invalid-date",
    );
  if (fields.mode === "date") {
    return {
      dueAt: null,
      dueOn: fields.dueDate,
      durationMinutes: null,
    } as const;
  }
  if (!clockPattern.test(fields.dueTime))
    throw new TaskEditorValidationError("due-time-required");
  try {
    return {
      dueAt: zonedInstant(fields.dueDate, fields.dueTime, fields.timeZone),
      dueOn: null,
    } as const;
  } catch (error) {
    if (error instanceof WallClockError)
      throw new TaskEditorValidationError(error.issue);
    throw error;
  }
}

function statusPayload(
  fields: TaskEditorFields,
  source: TaskResponse | undefined,
  now: Date,
) {
  return {
    completedAt:
      fields.status === "done"
        ? source?.status === "done"
          ? source.completedAt
          : now.toISOString()
        : null,
    status: fields.status,
  };
}

function taskPayload(
  fields: TaskEditorFields,
  source: TaskResponse | undefined,
  now: Date,
) {
  return {
    ...contentPayload(fields),
    ...schedulePayload(fields),
    ...statusPayload(fields, source, now),
  };
}

export function taskCreatePayload(
  fields: TaskEditorFields,
  commandId: string,
  now: Date = new Date(),
): EventContextCreatePayload {
  return {
    commandId,
    resource: {
      objectType: "task",
      ...taskPayload(fields, undefined, now),
    },
  };
}

export function taskUpdatePayload(
  fields: TaskEditorFields,
  source: TaskResponse,
  expectedVersion: number = source.version,
  now: Date = new Date(),
): TaskUpdatePayload {
  return {
    ...taskPayload(fields, source, now),
    expectedVersion,
  };
}

export function sameTaskFields(
  first: TaskEditorFields,
  second: TaskEditorFields,
): boolean {
  return (Object.keys(first) as (keyof TaskEditorFields)[]).every(
    (key) => first[key] === second[key],
  );
}
