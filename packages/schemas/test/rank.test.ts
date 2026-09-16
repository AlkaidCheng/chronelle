import { describe, expect, it } from "vitest";
import { rankAfter, rankBetween, rankSchema } from "../src/index.js";

describe("collection rank", () => {
  it("accepts eleven digits with an optional fraction and refuses the rest", () => {
    for (const rank of ["00000001000", "00000001000.5", "00000001000.625"])
      expect(rankSchema.safeParse(rank).success).toBe(true);
    for (const rank of ["1000", "00000001000.", "00000001000.50", "a", ""])
      expect(rankSchema.safeParse(rank).success).toBe(false);
  });

  it("ranks a new item after the last, a thousand on", () => {
    expect(rankAfter(null)).toBe("00000001000");
    expect(rankAfter("00000001000")).toBe("00000002000");
    expect(rankAfter("00000001000.5")).toBe("00000002000");
  });

  it("finds a midpoint that sorts between its neighbours as text", () => {
    const cases: [string | null, string | null][] = [
      ["00000001000", "00000002000"],
      ["00000001000", "00000001001"],
      ["00000001000.5", "00000001001"],
      ["00000001000.5", "00000001000.625"],
      [null, "00000001000"],
      [null, "00000000001"],
    ];
    for (const [before, after] of cases) {
      const mid = rankBetween(before, after);
      expect(rankSchema.safeParse(mid).success).toBe(true);
      if (before !== null) expect(mid > before).toBe(true);
      if (after !== null) expect(mid < after).toBe(true);
    }
    expect(rankBetween("00000001000", "00000002000")).toBe("00000001500");
    expect(rankBetween("00000001000", "00000001001")).toBe("00000001000.5");
    expect(rankBetween(null, null)).toBe("00000001000");
    expect(rankBetween("00000001000", null)).toBe("00000002000");
  });

  it("keeps text order numeric through a long run of insertions at one spot", () => {
    let low = "00000001000";
    const high = "00000001001";
    const seen = [low];
    for (let i = 0; i < 40; i += 1) {
      low = rankBetween(low, high);
      seen.push(low);
    }
    const sorted = [...seen].sort();
    expect(sorted).toEqual(seen);
    expect(seen.every((rank) => rank < high)).toBe(true);
  });

  it("refuses neighbours out of order", () => {
    expect(() => rankBetween("00000002000", "00000001000")).toThrow(RangeError);
    expect(() => rankBetween("00000001000", "00000001000")).toThrow(RangeError);
  });
});
