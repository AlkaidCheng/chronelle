import type { TaroStorage } from "../auth/session-store";
import {
  BoundedDraftStore,
  editorDraftLifetimeMs,
  maximumEditorDrafts,
} from "../runtime/bounded-draft-store";
import type { TaskDueMode, TaskEditorFields } from "./editor";

export const taskDraftStorageKey = "chronelle.task-drafts.v1";
export const maximumTaskDrafts = maximumEditorDrafts;
export const taskDraftLifetimeMs = editorDraftLifetimeMs;

export interface TaskDraftIdentity {
  readonly eventId: string;
  readonly taskId: string | null;
  readonly userId: string;
  readonly workspaceId: string;
}

export interface TaskDraftSnapshot extends TaskDraftIdentity {
  readonly baseline: TaskEditorFields;
  readonly commandId: string | null;
  readonly fields: TaskEditorFields;
  readonly sourceVersion: number | null;
  readonly updatedAt: string;
}

function isString(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

function parseFields(value: unknown): TaskEditorFields | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const fields = value as Record<string, unknown>;
  const mode = fields.mode as TaskDueMode;
  const status = fields.status as TaskEditorFields["status"];
  if (
    !["undated", "date", "timed"].includes(mode) ||
    !["todo", "in_progress", "done", "cancelled"].includes(status) ||
    !isString(fields.displayName, 240) ||
    !isString(fields.description, 2_000) ||
    !isString(fields.location, 240) ||
    !isString(fields.dueDate, 10) ||
    !isString(fields.dueTime, 5) ||
    !isString(fields.timeZone, 120) ||
    !(fields.sectionId === null || isUuid(fields.sectionId))
  )
    return null;
  return {
    description: fields.description,
    displayName: fields.displayName,
    dueDate: fields.dueDate,
    dueTime: fields.dueTime,
    location: fields.location,
    mode,
    sectionId: fields.sectionId,
    status,
    timeZone: fields.timeZone,
  };
}

function parseDraft(value: unknown): TaskDraftSnapshot | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const draft = value as Record<string, unknown>;
  const baseline = parseFields(draft.baseline);
  const fields = parseFields(draft.fields);
  if (
    !isUuid(draft.eventId) ||
    !(draft.taskId === null || isUuid(draft.taskId)) ||
    !isUuid(draft.userId) ||
    !isUuid(draft.workspaceId) ||
    !(draft.commandId === null || isUuid(draft.commandId)) ||
    !(
      draft.sourceVersion === null ||
      (typeof draft.sourceVersion === "number" &&
        Number.isInteger(draft.sourceVersion) &&
        draft.sourceVersion > 0)
    ) ||
    typeof draft.updatedAt !== "string" ||
    Number.isNaN(Date.parse(draft.updatedAt)) ||
    baseline === null ||
    fields === null
  )
    return null;
  if (
    (draft.taskId === null && draft.commandId === null) ||
    (draft.taskId !== null && draft.sourceVersion === null)
  )
    return null;
  return {
    baseline,
    commandId: draft.commandId,
    eventId: draft.eventId,
    fields,
    sourceVersion: draft.sourceVersion,
    taskId: draft.taskId,
    updatedAt: draft.updatedAt,
    userId: draft.userId,
    workspaceId: draft.workspaceId,
  };
}

function identityKey(value: TaskDraftIdentity): string {
  return `${value.userId}:${value.workspaceId}:${value.eventId}:${value.taskId ?? "new"}`;
}

export class TaskDraftStore extends BoundedDraftStore<
  TaskDraftIdentity,
  TaskDraftSnapshot
> {
  constructor(storage: TaroStorage, clock: () => Date = () => new Date()) {
    super({
      clock,
      identityKey,
      lifetimeMs: taskDraftLifetimeMs,
      limit: maximumTaskDrafts,
      parse: parseDraft,
      storage,
      storageKey: taskDraftStorageKey,
    });
  }
}
