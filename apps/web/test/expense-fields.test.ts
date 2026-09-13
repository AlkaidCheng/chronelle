import { afterEach, describe, expect, it, vi } from "vitest";
import { expenseFieldsPayload, readExpenseFields } from "../lib/expense-fields";

describe("Expense field conversion", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("initializes one transaction time when opening a new form", () => {
    vi.stubEnv("TZ", "UTC");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-07-03T18:30:45.678Z"));
    expect(readExpenseFields()).toEqual({
      displayName: "",
      amount: "",
      currency: "USD",
      occurredAt: "2030-07-03T18:30",
    });
  });

  it.each(["999999999999999.9999", "-0.0001", "12.3400"])(
    "preserves decimal text %s and the unchanged precise instant",
    (amount) => {
      vi.stubEnv("TZ", "America/Los_Angeles");
      const source = {
        displayName: "Deposit",
        amount,
        currency: "CNY",
        occurredAt: "2030-07-03T18:30:45.678Z",
      };
      const fields = readExpenseFields(source);
      expect(fields.occurredAt).toBe("2030-07-03T11:30");
      expect(
        expenseFieldsPayload(
          { ...fields, displayName: "Venue deposit" },
          source,
        ),
      ).toEqual({ ...source, displayName: "Venue deposit" });
    },
  );

  it("converts an explicit local transaction time", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    expect(
      expenseFieldsPayload({
        displayName: "Deposit",
        amount: "5.0001",
        currency: "USD",
        occurredAt: "2030-07-03T12:30",
      }).occurredAt,
    ).toBe("2030-07-03T19:30:00.000Z");
  });

  it.each([
    ["", "Choose a transaction date"],
    ["invalid", "Choose a valid transaction date"],
    ["2030-03-10T02:30", "local time is unavailable"],
  ])(
    "rejects missing, invalid or unavailable time %s",
    (occurredAt, message) => {
      vi.stubEnv("TZ", "America/New_York");
      expect(() =>
        expenseFieldsPayload({
          displayName: "Deposit",
          amount: "1.0000",
          currency: "USD",
          occurredAt,
        }),
      ).toThrow(message);
    },
  );
});
