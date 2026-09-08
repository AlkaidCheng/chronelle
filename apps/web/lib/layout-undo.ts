export interface LayoutUndoState {
  readonly version: number;
  readonly undo: number[];
  readonly redo: number[];
}
export type LayoutIntent = "edit" | "undo" | "redo";
export const emptyLayoutUndo: LayoutUndoState = {
  version: 0,
  undo: [],
  redo: [],
};

export function advanceLayoutUndo(
  state: LayoutUndoState,
  previousVersion: number,
  version: number,
  intent: LayoutIntent,
): LayoutUndoState {
  const current = state.version === previousVersion ? state : emptyLayoutUndo;
  if (intent === "undo")
    return {
      version,
      undo: current.undo.slice(0, -1),
      redo: [...current.redo, previousVersion].slice(-50),
    };
  if (intent === "redo")
    return {
      version,
      undo: [...current.undo, previousVersion].slice(-50),
      redo: current.redo.slice(0, -1),
    };
  return {
    version,
    undo: [...current.undo, previousVersion].slice(-50),
    redo: [],
  };
}
