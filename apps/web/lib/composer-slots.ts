"use client";

import { useMemo, useState } from "react";

/**
 * Which composer a list holds open, owned by the list's container: one
 * row or one add row at a time. Opening another while the open one holds
 * unsaved changes asks that one first; it answers by discarding (the next
 * opens) or keeping (nothing changes). The container owns this rather
 * than the rows because an add row under an empty list and the one after
 * its first item are different elements, and the composer must stay open
 * across that change.
 */
export interface ComposerSlots {
  /** The key of the open composer, or null. */
  readonly open: string | null;
  /** The key waiting to open while the open composer is asked. */
  readonly pending: string | null;
  /** Opens a composer, or asks the open one when it holds unsaved changes. */
  readonly request: (key: string) => void;
  readonly close: (key: string) => void;
  /** The open composer reports whether it holds unsaved changes. */
  readonly setDirty: (key: string, dirty: boolean) => void;
  /** The asked composer answers: discard its changes and let the next open, or keep them. */
  readonly answer: (key: string, discard: boolean) => void;
}

interface SlotsState {
  readonly open: string | null;
  readonly dirty: boolean;
  readonly pending: string | null;
}

const nothingOpen: SlotsState = { open: null, dirty: false, pending: null };

export function useComposerSlots(): ComposerSlots {
  const [state, setState] = useState<SlotsState>(nothingOpen);
  return useMemo(
    () => ({
      open: state.open,
      pending: state.pending,
      request: (key) =>
        setState((current) => {
          if (current.open === key) return { ...current, pending: null };
          if (current.open !== null && current.dirty)
            return { ...current, pending: key };
          return { open: key, dirty: false, pending: null };
        }),
      close: (key) =>
        setState((current) => (current.open === key ? nothingOpen : current)),
      setDirty: (key, dirty) =>
        setState((current) =>
          current.open === key && current.dirty !== dirty
            ? { ...current, dirty }
            : current,
        ),
      answer: (key, discard) =>
        setState((current) => {
          if (current.open !== key) return current;
          if (!discard) return { ...current, pending: null };
          return { open: current.pending, dirty: false, pending: null };
        }),
    }),
    [state],
  );
}

/** The key of a row's composer: the task it edits. */
export const rowComposerKey = (taskId: string) => `task:${taskId}`;

/** The key of an add row's composer: the list, or a day group. */
export const addComposerKey = (slot: string) => `add:${slot}`;
