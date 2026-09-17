"use client";

import { useEffect } from "react";
import { undoDirection } from "./keyboard";
import { useCommandState, useCommandTransition } from "./queries";

/**
 * Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z run the content undo and redo of the
 * workspace, outside text fields and dialogs. A page that owns a layout
 * stack while arranging handles the keys first and marks them consumed.
 */
export function useContentUndoShortcut(enabled = true) {
  const state = useCommandState();
  const undo = useCommandTransition("undo");
  const redo = useCommandTransition("redo");
  const heads = state.data;
  const busy = undo.isPending || redo.isPending;
  const runUndo = undo.mutate;
  const runRedo = redo.mutate;
  useEffect(() => {
    if (!enabled || heads === undefined) return;
    function onKeyDown(event: KeyboardEvent) {
      const direction = undoDirection(event);
      if (direction === null || busy) return;
      const head = heads?.[direction];
      if (head === null || head === undefined || !head.available) return;
      event.preventDefault();
      (direction === "undo" ? runUndo : runRedo)();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, heads, busy, runUndo, runRedo]);
}
