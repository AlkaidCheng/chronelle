"use client";

import { type RefObject, useCallback, useEffect, useRef } from "react";

/**
 * Brings focus back into a panel once an editor opened from it closes. The
 * control the editor came from may be gone by then (an add row's composer
 * closed as it handed over; a list replaced its row as it took its first
 * item), so for a moment after the close every render that finds focus
 * lost (on the body or the workspace) moves it to the element the selector
 * names inside the panel.
 */
export function useReturnFocus(panel: RefObject<HTMLElement | null>) {
  const until = useRef(0);
  const target = useRef("");
  useEffect(() => {
    if (Date.now() > until.current) return;
    const active = document.activeElement;
    if (active === document.body || active?.id === "workspace-content")
      panel.current?.querySelector<HTMLElement>(target.current)?.focus();
  });
  return useCallback((selector: string) => {
    target.current = selector;
    until.current = Date.now() + 1500;
  }, []);
}

/** The add row of a list, where focus returns after an editor opened from it. */
export const addRowSelector = ".quick-add";

/** A task's row button, where focus returns after its editor closes. */
export const rowSelector = (taskId: string) =>
  `[id="task-${taskId}"] .row-press`;

/** A record's row button by the row's id, where focus returns after its composer saves. */
export const recordRowSelector = (rowId: string) =>
  `[id="${rowId}"] .row-press`;
