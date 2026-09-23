import { ApiClientError } from "@chronelle/api-client";
import type { RecoveryPreview, TrashItem } from "@chronelle/schemas";

import type { MessageKey } from "../i18n/catalog";

export const trashObjectTypes = [
  "event",
  "task",
  "expense",
  "reminder",
  "document",
  "person",
  "note",
] as const satisfies readonly TrashItem["objectType"][];

export const trashTypeLabels: Readonly<
  Record<TrashItem["objectType"], MessageKey>
> = {
  event: "trashEvent",
  task: "trashTask",
  expense: "trashExpense",
  reminder: "trashReminder",
  document: "trashDocument",
  person: "trashPerson",
  note: "trashNote",
};

export function trashQueryKey(
  workspaceId: string,
  objectType: TrashItem["objectType"] | null,
) {
  return ["wechat-trash", workspaceId, objectType] as const;
}

export function recoveryPreviewQueryKey(workspaceId: string, objectId: string) {
  return ["wechat-recovery-preview", workspaceId, objectId] as const;
}

export function recoveryTarget(preview: RecoveryPreview) {
  return preview.canRecover
    ? {
        id: preview.object.id,
        expectedVersion: preview.object.version,
      }
    : null;
}

export function recoveryErrorKind(
  error: unknown,
): "unavailable" | "conflict" | "request" {
  if (error instanceof ApiClientError) {
    if (error.status === 403 || error.status === 404) return "unavailable";
    if (error.status === 409) return "conflict";
  }
  return "request";
}
