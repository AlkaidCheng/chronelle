import {
  type TaskRepeatRule,
  type TaskResponse,
  taskRepeatRuleSchema,
} from "@chronelle/schemas";
import { tr } from "../i18n/active-locale";
import { editedInstant } from "./edited-instant";
import { toDateTimeInput } from "./format";
import { descriptionPayload } from "./description-field";
import { locationPayload } from "./location-field";

export { locationLimit } from "./location-field";

/**
 * The editor's due fields: a calendar date, an optional local time, and an
 * optional repeat rule with its last date. A task due on a date fills only
 * the date; a task due at an instant fills both from the local rendering of
 * that instant.
 */
export function readTaskFields(
  task?: Pick<
    TaskResponse,
    | "displayName"
    | "dueOn"
    | "dueAt"
    | "durationMinutes"
    | "repeatRule"
    | "repeatUntil"
    | "assigneeId"
    | "location"
    | "description"
    | "labelIds"
  > & { readonly sectionId?: string | null | undefined },
): TaskFields {
  const [dueDate = "", dueTime = ""] =
    task?.dueOn !== null && task?.dueOn !== undefined
      ? [task.dueOn, ""]
      : toDateTimeInput(task?.dueAt ?? null).split("T");
  return {
    displayName: task?.displayName ?? "",
    dueDate,
    dueTime,
    // The duration in minutes as text; empty for none.
    duration:
      task?.durationMinutes === null || task?.durationMinutes === undefined
        ? ""
        : String(task.durationMinutes),
    // The repeat rule and its last date; empty for none.
    repeat: task?.repeatRule ?? "",
    repeatUntil: task?.repeatUntil ?? "",
    // The assignee's person id; empty for an unassigned task.
    assignee: task?.assigneeId ?? "",
    location: task?.location ?? "",
    description: task?.description ?? "",
    // Label ids as one sorted string, so an unchanged set compares equal.
    labels: joinLabelIds(task?.labelIds ?? []),
    // The section's id, empty for a loose task; a source that names no
    // section (a draft kept before the field existed) leaves it out.
    ...(task?.sectionId === undefined ? {} : { section: task.sectionId ?? "" }),
  };
}

/** The editor's flat fields, every one text. */
export type TaskFields = {
  readonly displayName: string;
  readonly dueDate: string;
  readonly dueTime: string;
  readonly duration: string;
  readonly repeat: string;
  readonly repeatUntil: string;
  readonly assignee: string;
  readonly location: string;
  readonly description: string;
  readonly labels: string;
  readonly section?: string | undefined;
};

/** The fields of a task that has nothing set: what an add composer starts with. */
export const emptyTaskFields: TaskFields = readTaskFields();

/**
 * The fields a composer hands to the dialog: those that are set, so a
 * dialog opened from an untouched composer opens clean, and one opened
 * from a composer with a name, a day, or a section starts with them.
 */
export function setTaskFields(fields: TaskFields): Partial<TaskFields> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== ""),
  ) as Partial<TaskFields>;
}

export function joinLabelIds(labelIds: readonly string[]): string {
  return [...new Set(labelIds)].sort().join(",");
}

export function splitLabelIds(labels: string): string[] {
  return labels === "" ? [] : labels.split(",");
}

/** The most minutes a duration may hold: a whole day. */
export const durationLimit = 1440;

/**
 * A date alone is a date-only due; a date with a time is a due instant,
 * preserved unchanged when the local rendering did not change. A time
 * without a date is refused, as is a duration without a time, a repeat
 * without a date, and a repeat's end before the date.
 */
export function taskFieldsPayload(
  fields: TaskFields,
  source?: Pick<TaskResponse, "dueAt">,
) {
  const v = tr("validation");
  const assigneeId = fields.assignee === "" ? null : fields.assignee;
  const location = locationPayload(fields.location);
  const description = descriptionPayload(fields.description);
  const labelIds = splitLabelIds(fields.labels);
  const sectionId = sectionPayload(fields.section);
  const durationMinutes =
    fields.duration === "" ? null : Number(fields.duration);
  if (
    durationMinutes !== null &&
    (!Number.isInteger(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > durationLimit)
  )
    throw new Error(v("durationRange"));
  const repeat = readRepeat(fields);
  if (fields.dueDate === "") {
    if (fields.dueTime !== "") throw new Error(v("dueDateForTime"));
    if (durationMinutes !== null) throw new Error(v("dueTimeForDuration"));
    if (repeat.repeatRule !== null) throw new Error(v("dueDateForRepeat"));
    return {
      displayName: fields.displayName,
      dueOn: null,
      dueAt: null,
      durationMinutes: null,
      ...repeat,
      assigneeId,
      location,
      description,
      labelIds,
      ...sectionId,
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.dueDate))
    throw new Error(v("validDueDate"));
  if (repeat.repeatUntil !== null && repeat.repeatUntil < fields.dueDate)
    throw new Error(v("repeatEndAfterDue"));
  if (fields.dueTime === "") {
    if (durationMinutes !== null) throw new Error(v("dueTimeForDuration"));
    return {
      displayName: fields.displayName,
      dueOn: fields.dueDate,
      dueAt: null,
      durationMinutes: null,
      ...repeat,
      assigneeId,
      location,
      description,
      labelIds,
      ...sectionId,
    };
  }
  return {
    displayName: fields.displayName,
    dueOn: null,
    dueAt: editedInstant(
      `${fields.dueDate}T${fields.dueTime}`,
      source?.dueAt,
      "due",
    ),
    durationMinutes,
    ...repeat,
    assigneeId,
    location,
    description,
    labelIds,
    ...sectionId,
  };
}

/**
 * The section as the API takes it: null clears it, an id names it, and a
 * draft kept before the field existed leaves it unchanged.
 */
export function sectionPayload(
  section: string | undefined,
): { sectionId: string | null } | Record<never, never> {
  if (section === undefined) return {};
  return { sectionId: section === "" ? null : section };
}

/** The rule and its end as the API takes them; an end needs a rule. */
function readRepeat(fields: { repeat: string; repeatUntil: string }): {
  repeatRule: TaskRepeatRule | null;
  repeatUntil: string | null;
} {
  if (fields.repeat === "") return { repeatRule: null, repeatUntil: null };
  const rule = taskRepeatRuleSchema.safeParse(fields.repeat);
  if (!rule.success) throw new Error(tr("validation")("repeatOffered"));
  if (
    fields.repeatUntil !== "" &&
    !/^\d{4}-\d{2}-\d{2}$/.test(fields.repeatUntil)
  )
    throw new Error(tr("validation")("validRepeatEnd"));
  return {
    repeatRule: rule.data,
    repeatUntil: fields.repeatUntil === "" ? null : fields.repeatUntil,
  };
}
