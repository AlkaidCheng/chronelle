import { describe, expect, it } from "vitest";

import { describeLayoutChanges } from "../lib/layout-changes";

const page = (
  id: string,
  name: string,
  kinds: readonly (readonly [string, "todos" | "calendar" | "expenses"])[],
) => ({
  id,
  name,
  components: kinds.map(([componentId, kind]) => ({ id: componentId, kind })),
});

describe("describeLayoutChanges", () => {
  it("reads a move, an addition, and a removal as sentences", () => {
    const before = [
      page("p1", "Plan", [
        ["c1", "todos"],
        ["c2", "calendar"],
        ["c3", "expenses"],
      ]),
    ];
    expect(
      describeLayoutChanges(before, [
        page("p1", "Plan", [
          ["c2", "calendar"],
          ["c1", "todos"],
          ["c3", "expenses"],
        ]),
      ]),
    ).toEqual({ sentences: ["Moved Calendar above To-dos"], more: 0 });
    expect(
      describeLayoutChanges(before, [
        page("p1", "Plan", [
          ["c1", "todos"],
          ["c3", "expenses"],
        ]),
        page("p2", "Packing", []),
      ]),
    ).toEqual({
      sentences: ["Added page Packing", "Removed component Calendar"],
      more: 0,
    });
    expect(
      describeLayoutChanges(before, [
        page("p1", "Plan", [
          ["c1", "todos"],
          ["c2", "calendar"],
          ["c3", "expenses"],
          ["c4", "todos"],
        ]),
      ]),
    ).toEqual({ sentences: ["Added To-dos to Plan"], more: 0 });
  });

  it("counts the sentences past the first three", () => {
    const before = [page("p1", "Plan", [["c1", "todos"]])];
    const after = [
      page("p1", "Planning", [
        ["c1", "todos"],
        ["c2", "calendar"],
      ]),
      page("p2", "Packing", []),
      page("p3", "Budget", [["c3", "expenses"]]),
    ];
    const result = describeLayoutChanges(before, after);
    expect(result.sentences).toHaveLength(3);
    expect(result.more).toBe(1);
  });

  it("reads the empty layout as the start", () => {
    expect(
      describeLayoutChanges([], [page("p1", "Plan", [["c1", "todos"]])]),
    ).toEqual({ sentences: ["Added page Plan"], more: 0 });
  });
});
