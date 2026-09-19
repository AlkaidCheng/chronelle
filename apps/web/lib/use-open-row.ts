"use client";

import { useEffect, useMemo } from "react";

import type { ComposerSlots } from "./composer-slots";
import { useEditorDraftStore } from "./editor-draft-context";
import { type ComposerKind, recordComposerKey } from "./record-composers";

/**
 * A list's rows that open in place: the press that opens a row's composer
 * (absent where the rows cannot be edited), and the two cares the list
 * takes for it. A row left open in this tab, its draft kept, opens again
 * when the list comes back; a row that left the list closes its composer,
 * so a row that cannot be shown never holds the question.
 */
export function useOpenRow<Row extends { readonly id: string }>({
  canEdit,
  kind,
  rows,
  slots,
}: {
  readonly canEdit: boolean;
  readonly kind: ComposerKind;
  readonly rows: readonly Row[];
  readonly slots: ComposerSlots;
}) {
  const store = useEditorDraftStore();
  const prefix = `${kind}:`;
  const openRow =
    slots.open?.startsWith(prefix) === true
      ? slots.open.slice(prefix.length)
      : null;
  const openRowShown =
    openRow !== null && rows.some((row) => row.id === openRow);
  const { request, close, open } = slots;
  useEffect(() => {
    if (openRow !== null && !openRowShown) {
      close(recordComposerKey(kind, openRow));
      return;
    }
    if (open !== null || !canEdit) return;
    const left = rows.find((row) => store.get(row.id) !== undefined);
    if (left !== undefined) request(recordComposerKey(kind, left.id));
  }, [canEdit, close, kind, open, openRow, openRowShown, request, rows, store]);
  return useMemo(
    () =>
      canEdit
        ? (id: string) => request(recordComposerKey(kind, id))
        : undefined,
    [canEdit, kind, request],
  );
}
