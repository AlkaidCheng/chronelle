import { describe, expect, it } from "vitest";
import {
  byRank,
  rankAtIndex,
  rankBetweenRows,
  rankForStep,
  staysInPlace,
} from "../lib/collection-order";

const a = { id: "a", rank: "00000001000" };
const b = { id: "b", rank: "00000002000" };
const c = { id: "c", rank: "00000003000" };
const rows = [a, b, c];

describe("collection order", () => {
  it("orders by rank, then id", () => {
    const shuffled = [c, { id: "a2", rank: "00000001000" }, a];
    expect([...shuffled].sort(byRank).map((row) => row.id)).toEqual([
      "a",
      "a2",
      "c",
    ]);
  });

  it("ranks a drop at an index between its neighbours, and at the ends", () => {
    expect(rankAtIndex(rows, 0)).toBe("00000000500");
    expect(rankAtIndex(rows, 1)).toBe("00000001500");
    expect(rankAtIndex(rows, 3)).toBe("00000004000");
    expect(rankAtIndex([], 0)).toBe("00000001000");
  });

  it("goes after the row before when the neighbours are out of order", () => {
    expect(rankBetweenRows(c, a)).toBe("00000004000");
    expect(rankBetweenRows(undefined, a)).toBe("00000000500");
  });

  it("steps one place with the midpoint beyond the neighbour", () => {
    expect(rankForStep(rows, "c", -1)).toBe("00000001500");
    expect(rankForStep(rows, "a", 1)).toBe("00000002500");
    expect(rankForStep(rows, "b", 1)).toBe("00000004000");
    expect(rankForStep(rows, "a", -1)).toBeNull();
    expect(rankForStep(rows, "c", 1)).toBeNull();
    expect(rankForStep(rows, "zz", 1)).toBeNull();
  });

  it("knows when a drop leaves a row where it was", () => {
    const others = [a, c];
    expect(staysInPlace(rows, "b", others, 1)).toBe(true);
    expect(staysInPlace(rows, "b", others, 0)).toBe(false);
    expect(staysInPlace(rows, "b", others, 2)).toBe(false);
    expect(staysInPlace(rows, "b", [a], 1)).toBe(false);
  });
});
