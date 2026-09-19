"use client";

import { type ReactNode, useEffect, useRef } from "react";

import { PlusIcon } from "../../components/icons";
import type { ComposerSlots } from "../../lib/composer-slots";
import { useKeptEditorDraft } from "../../lib/editor-draft-context";

/**
 * The draft key of an add row's composer, apart from the kind's dialog's
 * (which keeps a save in flight or one whose answer was lost for its own
 * recovery); a section's or a day's row keeps its own.
 */
export function addRecordDraftId(dialogKey: string, slot: string | null) {
  const base = `${dialogKey}:composer`;
  return slot === null ? base : `${base}:${slot}`;
}

/**
 * The last row of a list of records, or of one of its groups: a quiet
 * "Add ..." line that opens the kind's composer, empty, in its place. The
 * list owns which composer is open, so the row under an empty list and
 * the one after its first item show the same composer. A composer left
 * open in this tab, its draft kept, opens again when the row comes back;
 * a draft whose save is still in flight is left to settle. When the
 * composer closes with nothing else opening, the row takes focus back.
 */
export function AddRecordRow({
  ariaLabel,
  composer,
  draftId,
  label,
  slotKey,
  slots,
}: {
  /** The row's accessible name when it says more than its words, e.g. "Add a reminder for Sep 21". */
  readonly ariaLabel?: string | undefined;
  /** The composer the row opens as. */
  readonly composer: ReactNode;
  /** The draft the row's composer keeps. */
  readonly draftId: string;
  /** The words of the row, e.g. "Add expense". */
  readonly label: string;
  readonly slotKey: string;
  readonly slots: ComposerSlots;
}) {
  const open = slots.open === slotKey;
  const kept = useKeptEditorDraft(draftId);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && slots.open === null) button.current?.focus();
    wasOpen.current = open;
  }, [open, slots.open]);
  const { open: openKey, request } = slots;
  useEffect(() => {
    if (openKey === null && kept !== undefined && !kept.pending)
      request(slotKey);
  }, [kept, openKey, request, slotKey]);
  if (open) return <>{composer}</>;
  return (
    <button
      aria-label={ariaLabel ?? label}
      className="quick-add"
      onClick={() => slots.request(slotKey)}
      ref={button}
      type="button"
    >
      <PlusIcon />
      <span>{label}</span>
    </button>
  );
}
