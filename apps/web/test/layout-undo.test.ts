import { describe, expect, it } from "vitest";
import { advanceLayoutUndo, emptyLayoutUndo } from "../lib/layout-undo";

describe("layout undo references", () => {
  it("walks undo and redo through append-only revisions", () => {
    let state = advanceLayoutUndo(emptyLayoutUndo, 0, 1, "edit");
    state = advanceLayoutUndo(state, 1, 2, "edit");
    expect(state.undo).toEqual([0, 1]);
    state = advanceLayoutUndo(state, 2, 3, "undo");
    expect(state).toEqual({ version: 3, undo: [0], redo: [2] });
    state = advanceLayoutUndo(state, 3, 4, "undo");
    expect(state).toEqual({ version: 4, undo: [], redo: [2, 3] });
    state = advanceLayoutUndo(state, 4, 5, "redo");
    expect(state).toEqual({ version: 5, undo: [4], redo: [2] });
    state = advanceLayoutUndo(state, 5, 6, "redo");
    expect(state).toEqual({ version: 6, undo: [4, 5], redo: [] });
  });

  it("clears redo on an edit and drops references across external changes", () => {
    const state = { version: 3, undo: [0], redo: [2] };
    expect(advanceLayoutUndo(state, 3, 4, "edit")).toEqual({
      version: 4,
      undo: [0, 3],
      redo: [],
    });
    expect(advanceLayoutUndo(state, 8, 9, "edit")).toEqual({
      version: 9,
      undo: [8],
      redo: [],
    });
  });

  it("bounds session memory without changing the immutable input", () => {
    let state = emptyLayoutUndo;
    for (let version = 1; version <= 100; version++)
      state = advanceLayoutUndo(state, version - 1, version, "edit");
    expect(state.undo).toHaveLength(50);
    expect(state.undo[0]).toBe(50);
    expect(emptyLayoutUndo).toEqual({ version: 0, undo: [], redo: [] });
  });
});
