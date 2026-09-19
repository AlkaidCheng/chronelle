"use client";

import { type ReactNode, useEffect, useRef } from "react";

import { PlusIcon } from "../../components/icons";
import type { ComposerSlots } from "../../lib/composer-slots";
import { useKeptEditorDraft } from "../../lib/editor-draft-context";

/**
 * The last row of a list of records, or of one of its groups: a quiet
 * "Add ..." line that opens the kind's composer, empty, in its place. The
 * list owns which composer is open, so the row under an empty list and
 * the one after its first item show the same composer. A composer left
 * open in this tab, its draft kept, opens again when the row comes back;
 * a draft whose save is still on its way, or failed, goes to the full
 * editor instead, which asks about it; while the full editor holds the
 * draft, the row leaves it there. When the composer closes with nothing
 * else opening, the row takes focus back.
 */
export function AddRecordRow({
  ariaLabel,
  composer,
  draftId,
  label,
  onRecover,
  slotKey,
  slots,
  suspended = false,
}: {
  /** The row's accessible name when it says more than its words, e.g. "Add a reminder for Sep 21". */
  readonly ariaLabel?: string | undefined;
  /** The composer the row opens as. */
  readonly composer: ReactNode;
  /** The draft the row's composer keeps, the key the kind's dialog uses. */
  readonly draftId: string;
  /** The words of the row, e.g. "Add expense". */
  readonly label: string;
  /** Opens the full editor, which settles a save on its way or failed. */
  readonly onRecover: () => void;
  readonly slotKey: string;
  readonly slots: ComposerSlots;
  /** The full editor is open over the list, holding the draft itself. */
  readonly suspended?: boolean;
}) {
  const open = slots.open === slotKey;
  const kept = useKeptEditorDraft(draftId);
  const unsettled = kept !== undefined && (kept.pending || kept.failed);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && slots.open === null) button.current?.focus();
    wasOpen.current = open;
  }, [open, slots.open]);
  const { open: openKey, request } = slots;
  useEffect(() => {
    if (suspended || openKey !== null || kept === undefined || unsettled)
      return;
    request(slotKey);
  }, [kept, openKey, request, slotKey, suspended, unsettled]);
  if (open) return <>{composer}</>;
  return (
    <button
      aria-label={ariaLabel ?? label}
      className="quick-add"
      onClick={() => (unsettled ? onRecover() : slots.request(slotKey))}
      ref={button}
      type="button"
    >
      <PlusIcon />
      <span>{label}</span>
    </button>
  );
}
