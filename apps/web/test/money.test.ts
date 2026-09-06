import { describe, expect, it } from "vitest";

import { formatMoney, sumMoneyByCurrency } from "../lib/money";

describe("formatMoney", () => {
  it.each([
    ["999999999999999.9900", "$999,999,999,999,999.99"],
    ["999999999999999.9999", "$999,999,999,999,999.9999"],
    ["-999999999999999.9999", "-$999,999,999,999,999.9999"],
    ["1.0001", "$1.0001"],
    ["-0.0001", "-$0.0001"],
    ["0.0000", "$0.00"],
  ])("preserves %s through display", (amount, expected) => {
    expect(formatMoney(amount, "USD", "en-US")).toBe(expected);
  });

  it.each([
    ["12.0000", "JPY", "\u00a512"],
    ["12.0001", "JPY", "\u00a512.0001"],
    ["12.3400", "USD", "$12.34"],
    ["12.3400", "KWD", "KWD\u00a012.340"],
    ["12.3456", "KWD", "KWD\u00a012.3456"],
    ["12", "CLF", "CLF\u00a012.0000"],
  ])(
    "respects %s %s minor units without losing precision",
    (amount, currency, expected) => {
      expect(formatMoney(amount, currency, "en-US")).toBe(expected);
    },
  );

  it("uses the requested locale's separators and currency placement", () => {
    expect(formatMoney("999999999999999.9999", "EUR", "de-DE")).toBe(
      "999.999.999.999.999,9999\u00a0\u20ac",
    );
    expect(formatMoney("1234567.8901", "INR", "en-IN")).toBe(
      "\u20b912,34,567.8901",
    );
  });

  it.each(["", "invalid", "NaN", "Infinity", "1e3", "0x10", "1.00001", "1\n"])(
    "leaves malformed amount %j visible without converting it",
    (amount) => {
      expect(formatMoney(amount, "USD", "en-US")).toBe(`USD ${amount}`);
    },
  );
});

describe("sumMoneyByCurrency", () => {
  it.each([
    [["0.1", "0.2"], "0.3000"],
    [["0.0001", "0.0001"], "0.0002"],
    [["999999999999999.9999", "0.0001"], "1000000000000000.0000"],
    [["999999999999999.9999", "999999999999999.9999"], "1999999999999999.9998"],
    [["999999999999999.9999", "-999999999999999.9998"], "0.0001"],
    [["-999999999999999.9999", "0.0001"], "-999999999999999.9998"],
    [["-0.0001", "-0.0001"], "-0.0002"],
    [["-0.0000", "0", "1.0001", "-1.0001"], "0.0000"],
    [["00012.3400", "0.0001"], "12.3401"],
  ])("sums %j exactly", (amounts, expected) => {
    const totals = sumMoneyByCurrency(
      amounts.map((amount) => ({ amount, currency: "USD" })),
    );
    expect(totals).toEqual([{ amount: expected, currency: "USD" }]);
  });

  it("keeps currencies separate without mutating the transactions", () => {
    const entries = Object.freeze([
      Object.freeze({ amount: "1.0001", currency: "EUR" }),
      Object.freeze({ amount: "2.0002", currency: "USD" }),
      Object.freeze({ amount: "-0.0001", currency: "EUR" }),
      Object.freeze({ amount: "0.0001", currency: "USD" }),
    ]);
    expect(sumMoneyByCurrency(entries)).toEqual([
      { amount: "1.0000", currency: "EUR" },
      { amount: "2.0003", currency: "USD" },
    ]);
    expect(entries[0]?.amount).toBe("1.0001");
  });

  it("returns no totals for an empty collection", () => {
    expect(sumMoneyByCurrency([])).toEqual([]);
  });

  it("keeps a large aggregate exact through formatting", () => {
    const entries = Array.from({ length: 1_000 }, () => ({
      amount: "999999999999999.9999",
      currency: "USD",
    }));
    const totals = sumMoneyByCurrency(entries);
    expect(totals).toEqual([
      {
        amount: "999999999999999999.9000",
        currency: "USD",
      },
    ]);
    expect(
      totals.map(({ amount, currency }) =>
        formatMoney(amount, currency, "en-US"),
      ),
    ).toEqual(["$999,999,999,999,999,999.90"]);
  });

  it.each(["invalid", "", "NaN", "Infinity", "1.00001", "1e3", "1\n"])(
    "rejects malformed amount %j instead of returning a partial total",
    (amount) => {
      expect(() =>
        sumMoneyByCurrency([
          { amount: "1.0000", currency: "USD" },
          { amount, currency: "USD" },
        ]),
      ).toThrow(RangeError);
    },
  );
});
