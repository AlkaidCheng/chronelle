import type { TaroStorage } from "../auth/session-store";
import {
  BoundedDraftStore,
  editorDraftLifetimeMs,
  maximumEditorDrafts,
} from "../runtime/bounded-draft-store";
import type { EventEditorFields, EventScheduleMode } from "./editor";

export const eventDraftStorageKey = "chronelle.event-drafts.v1";
export const maximumEventDrafts = maximumEditorDrafts;
export const eventDraftLifetimeMs = editorDraftLifetimeMs;

export interface EventDraftIdentity {
  readonly eventId: string | null;
  readonly userId: string;
  readonly workspaceId: string;
}

export interface EventDraftSnapshot extends EventDraftIdentity {
  readonly baseline: EventEditorFields;
  readonly commandId: string | null;
  readonly fields: EventEditorFields;
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

function parseFields(value: unknown): EventEditorFields | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const fields = value as Record<string, unknown>;
  const mode = fields.mode as EventScheduleMode;
  if (
    !["undated", "dates", "timed"].includes(mode) ||
    !isString(fields.displayName, 240) ||
    !isString(fields.description, 2_000) ||
    !isString(fields.location, 240) ||
    !isString(fields.startDate, 10) ||
    !isString(fields.endDate, 10) ||
    !isString(fields.startTime, 5) ||
    !isString(fields.endTime, 5) ||
    !isString(fields.timeZone, 120)
  ) {
    return null;
  }
  return {
    description: fields.description,
    displayName: fields.displayName,
    endDate: fields.endDate,
    endTime: fields.endTime,
    location: fields.location,
    mode,
    startDate: fields.startDate,
    startTime: fields.startTime,
    timeZone: fields.timeZone,
  };
}

function parseDraft(value: unknown): EventDraftSnapshot | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const draft = value as Record<string, unknown>;
  const baseline = parseFields(draft.baseline);
  const fields = parseFields(draft.fields);
  if (
    !isUuid(draft.userId) ||
    !isUuid(draft.workspaceId) ||
    !(draft.eventId === null || isUuid(draft.eventId)) ||
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
  ) {
    return null;
  }
  if (
    (draft.eventId === null && draft.commandId === null) ||
    (draft.eventId !== null && draft.sourceVersion === null)
  ) {
    return null;
  }
  return {
    baseline,
    commandId: draft.commandId,
    eventId: draft.eventId,
    fields,
    sourceVersion: draft.sourceVersion,
    updatedAt: draft.updatedAt,
    userId: draft.userId,
    workspaceId: draft.workspaceId,
  };
}

function identityKey(value: EventDraftIdentity): string {
  return `${value.userId}:${value.workspaceId}:${value.eventId ?? "new"}`;
}

export class EventDraftStore extends BoundedDraftStore<
  EventDraftIdentity,
  EventDraftSnapshot
> {
  constructor(storage: TaroStorage, clock: () => Date = () => new Date()) {
    super({
      clock,
      identityKey,
      lifetimeMs: eventDraftLifetimeMs,
      limit: maximumEventDrafts,
      parse: parseDraft,
      storage,
      storageKey: eventDraftStorageKey,
    });
  }
}
