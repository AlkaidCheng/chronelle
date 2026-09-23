import type { TaroStorage } from "../auth/session-store";
import {
  BoundedDraftStore,
  editorDraftLifetimeMs,
  maximumEditorDrafts,
} from "../runtime/bounded-draft-store";
import type { ReminderEditorFields } from "./editor";

export const reminderDraftStorageKey = "chronelle.reminder-drafts.v1";

export interface ReminderDraftIdentity {
  readonly eventId: string;
  readonly reminderId: string | null;
  readonly userId: string;
  readonly workspaceId: string;
}

export interface ReminderDraftSnapshot extends ReminderDraftIdentity {
  readonly baseline: ReminderEditorFields;
  readonly commandId: string | null;
  readonly fields: ReminderEditorFields;
  readonly sourceVersion: number | null;
  readonly updatedAt: string;
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

function isText(value: unknown, length: number): value is string {
  return typeof value === "string" && value.length <= length;
}

function parseFields(value: unknown): ReminderEditorFields | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const fields = value as Record<string, unknown>;
  if (
    !isText(fields.displayName, 240) ||
    !isText(fields.date, 10) ||
    !isText(fields.time, 5) ||
    !isText(fields.timeZone, 120) ||
    !["pending", "triggered", "dismissed", "cancelled"].includes(
      fields.status as string,
    )
  )
    return null;
  return {
    date: fields.date,
    displayName: fields.displayName,
    status: fields.status as ReminderEditorFields["status"],
    time: fields.time,
    timeZone: fields.timeZone,
  };
}

function parseDraft(value: unknown): ReminderDraftSnapshot | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const draft = value as Record<string, unknown>;
  const baseline = parseFields(draft.baseline);
  const fields = parseFields(draft.fields);
  if (
    !isUuid(draft.eventId) ||
    !(draft.reminderId === null || isUuid(draft.reminderId)) ||
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
    fields === null ||
    (draft.reminderId === null && draft.commandId === null) ||
    (draft.reminderId !== null && draft.sourceVersion === null)
  )
    return null;
  return {
    baseline,
    commandId: draft.commandId,
    eventId: draft.eventId,
    fields,
    reminderId: draft.reminderId,
    sourceVersion: draft.sourceVersion,
    updatedAt: draft.updatedAt,
    userId: draft.userId,
    workspaceId: draft.workspaceId,
  };
}

function identityKey(value: ReminderDraftIdentity): string {
  return `${value.userId}:${value.workspaceId}:${value.eventId}:${value.reminderId ?? "new"}`;
}

export class ReminderDraftStore extends BoundedDraftStore<
  ReminderDraftIdentity,
  ReminderDraftSnapshot
> {
  constructor(storage: TaroStorage, clock: () => Date = () => new Date()) {
    super({
      clock,
      identityKey,
      lifetimeMs: editorDraftLifetimeMs,
      limit: maximumEditorDrafts,
      parse: parseDraft,
      storage,
      storageKey: reminderDraftStorageKey,
    });
  }
}
