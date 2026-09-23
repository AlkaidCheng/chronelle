import type { TaroStorage } from "../auth/session-store";
import {
  BoundedDraftStore,
  editorDraftLifetimeMs,
  maximumEditorDrafts,
} from "../runtime/bounded-draft-store";
import type { ExpenseEditorFields } from "./editor";

export const expenseDraftStorageKey = "chronelle.expense-drafts.v1";

export interface ExpenseDraftIdentity {
  readonly eventId: string;
  readonly expenseId: string | null;
  readonly userId: string;
  readonly workspaceId: string;
}

export interface ExpenseDraftSnapshot extends ExpenseDraftIdentity {
  readonly baseline: ExpenseEditorFields;
  readonly commandId: string | null;
  readonly fields: ExpenseEditorFields;
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

function parseFields(value: unknown): ExpenseEditorFields | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const fields = value as Record<string, unknown>;
  if (
    !isText(fields.displayName, 240) ||
    !isText(fields.amount, 24) ||
    !isText(fields.currency, 3) ||
    !isText(fields.date, 10) ||
    !isText(fields.time, 5) ||
    !isText(fields.timeZone, 120) ||
    !(fields.sectionId === null || isUuid(fields.sectionId))
  )
    return null;
  return {
    amount: fields.amount,
    currency: fields.currency,
    date: fields.date,
    displayName: fields.displayName,
    sectionId: fields.sectionId,
    time: fields.time,
    timeZone: fields.timeZone,
  };
}

function parseDraft(value: unknown): ExpenseDraftSnapshot | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const draft = value as Record<string, unknown>;
  const baseline = parseFields(draft.baseline);
  const fields = parseFields(draft.fields);
  if (
    !isUuid(draft.eventId) ||
    !(draft.expenseId === null || isUuid(draft.expenseId)) ||
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
    (draft.expenseId === null && draft.commandId === null) ||
    (draft.expenseId !== null && draft.sourceVersion === null)
  )
    return null;
  return {
    baseline,
    commandId: draft.commandId,
    eventId: draft.eventId,
    expenseId: draft.expenseId,
    fields,
    sourceVersion: draft.sourceVersion,
    updatedAt: draft.updatedAt,
    userId: draft.userId,
    workspaceId: draft.workspaceId,
  };
}

function identityKey(value: ExpenseDraftIdentity): string {
  return `${value.userId}:${value.workspaceId}:${value.eventId}:${value.expenseId ?? "new"}`;
}

export class ExpenseDraftStore extends BoundedDraftStore<
  ExpenseDraftIdentity,
  ExpenseDraftSnapshot
> {
  constructor(storage: TaroStorage, clock: () => Date = () => new Date()) {
    super({
      clock,
      identityKey,
      lifetimeMs: editorDraftLifetimeMs,
      limit: maximumEditorDrafts,
      parse: parseDraft,
      storage,
      storageKey: expenseDraftStorageKey,
    });
  }
}
