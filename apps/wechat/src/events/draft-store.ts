import type { TaroStorage } from "../auth/session-store";
import type { EventEditorFields, EventScheduleMode } from "./editor";

export const eventDraftStorageKey = "chronelle.event-drafts.v1";
export const maximumEventDrafts = 20;
export const eventDraftLifetimeMs = 7 * 24 * 60 * 60_000;

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

interface StoredEventDrafts {
  readonly drafts: readonly EventDraftSnapshot[];
  readonly version: 1;
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

export class EventDraftStore {
  readonly #clock: () => Date;
  readonly #storage: TaroStorage;
  #pending: Promise<void> = Promise.resolve();

  constructor(storage: TaroStorage, clock: () => Date = () => new Date()) {
    this.#clock = clock;
    this.#storage = storage;
  }

  async load(identity: EventDraftIdentity): Promise<EventDraftSnapshot | null> {
    await this.#pending;
    return (
      (await this.#read()).find(
        (draft) => identityKey(draft) === identityKey(identity),
      ) ?? null
    );
  }

  save(snapshot: EventDraftSnapshot): Promise<void> {
    return this.#mutate(async () => {
      const key = identityKey(snapshot);
      const drafts = (await this.#read()).filter(
        (draft) => identityKey(draft) !== key,
      );
      const stored: StoredEventDrafts = {
        version: 1,
        drafts: [snapshot, ...drafts]
          .sort((first, second) =>
            second.updatedAt.localeCompare(first.updatedAt),
          )
          .slice(0, maximumEventDrafts),
      };
      await this.#storage.setStorage({
        key: eventDraftStorageKey,
        data: stored,
      });
    });
  }

  remove(identity: EventDraftIdentity): Promise<void> {
    return this.#mutate(async () => {
      const key = identityKey(identity);
      const drafts = (await this.#read()).filter(
        (draft) => identityKey(draft) !== key,
      );
      if (drafts.length === 0) {
        await this.#storage.removeStorage({ key: eventDraftStorageKey });
        return;
      }
      await this.#storage.setStorage({
        key: eventDraftStorageKey,
        data: { version: 1, drafts } satisfies StoredEventDrafts,
      });
    });
  }

  #mutate(operation: () => Promise<void>): Promise<void> {
    const next = this.#pending.then(operation, operation);
    this.#pending = next.catch(() => undefined);
    return next;
  }

  async #read(): Promise<EventDraftSnapshot[]> {
    let value: unknown;
    try {
      value = (await this.#storage.getStorage({ key: eventDraftStorageKey }))
        .data;
    } catch {
      return [];
    }
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return [];
    const envelope = value as Record<string, unknown>;
    if (envelope.version !== 1 || !Array.isArray(envelope.drafts)) return [];
    const cutoff = this.#clock().getTime() - eventDraftLifetimeMs;
    return envelope.drafts
      .map(parseDraft)
      .filter(
        (draft): draft is EventDraftSnapshot =>
          draft !== null && Date.parse(draft.updatedAt) >= cutoff,
      )
      .slice(0, maximumEventDrafts);
  }
}
