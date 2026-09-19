"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

import type { ComposerSlots } from "./composer-slots";

/** Which chip's control is open under a composer, and the moves between them. */
export function useComposerChips<Chip extends string>() {
  const [openChip, setOpenChip] = useState<Chip | null>(null);
  const buttons = useRef<Partial<Record<Chip, HTMLButtonElement>>>({});
  const close = (chip: Chip) => (byKeyboard: boolean) => {
    setOpenChip((current) => (current === chip ? null : current));
    if (byKeyboard) buttons.current[chip]?.focus();
  };
  const toggle = (chip: Chip) =>
    setOpenChip((current) => (current === chip ? null : chip));
  const open = (chip: Chip) => setOpenChip(chip);
  const ref = (chip: Chip) => (element: HTMLButtonElement | null) => {
    if (element === null) delete buttons.current[chip];
    else buttons.current[chip] = element;
  };
  return { openChip, close, open, toggle, ref };
}

/**
 * What every composer does around its fields: it tells the list whether it
 * holds unsaved changes (so opening another row asks first), takes focus
 * in its name as it opens with the caret after the text, reads the newest
 * version at once when a save is refused as stale (so the comparison
 * appears in place of the refusal), and resubmits once Keep mine or Save
 * merged version has pinned the draft to that version.
 */
export function useComposerCare({
  hasNewerVersion,
  isDirty,
  nameInput,
  onRefresh,
  slotKey,
  slots,
  stale,
  staleError,
}: {
  readonly hasNewerVersion: boolean;
  readonly isDirty: boolean;
  readonly nameInput: RefObject<HTMLInputElement | null>;
  readonly onRefresh: () => Promise<unknown>;
  readonly slotKey: string;
  readonly slots: ComposerSlots;
  /** A save just refused as stale. */
  readonly stale: boolean;
  readonly staleError: unknown;
}) {
  useEffect(() => {
    slots.setDirty(slotKey, isDirty);
  }, [isDirty, slotKey, slots]);
  useEffect(() => {
    const input = nameInput.current;
    if (input === null) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [nameInput]);
  const refreshedFor = useRef<unknown>(null);
  useEffect(() => {
    if (!stale || refreshedFor.current === staleError) return;
    refreshedFor.current = staleError;
    void onRefresh();
  }, [onRefresh, stale, staleError]);
  const submitOnceRebased = useRef(false);
  useEffect(() => {
    if (!submitOnceRebased.current || hasNewerVersion) return;
    submitOnceRebased.current = false;
    nameInput.current?.form?.requestSubmit();
  }, [hasNewerVersion, nameInput]);
  return { submitOnceRebased };
}
