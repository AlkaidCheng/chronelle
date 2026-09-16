import { afterEach, describe, expect, it, vi } from "vitest";
import {
  quickReminderInstant,
  readReminderFields,
  reminderFieldsPayload,
} from "../lib/reminder-fields";

describe("Reminder field conversion", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("starts with a blank required time", () => {
    expect(readReminderFields()).toEqual({ displayName: "", remindAt: "" });
    expect(() => reminderFieldsPayload(readReminderFields())).toThrow(
      "Choose a reminder date and time",
    );
  });

  it.each(["pending", "triggered", "dismissed", "cancelled"] as const)(
    "preserves precise instants without sending or resetting %s status",
    (status) => {
      vi.stubEnv("TZ", "America/Los_Angeles");
      const source = {
        displayName: "Headcount",
        remindAt: "2030-07-03T18:30:45.678Z",
        status,
      };
      expect(
        reminderFieldsPayload(
          { ...readReminderFields(source), displayName: "Final headcount" },
          source,
        ),
      ).toEqual({
        displayName: "Final headcount",
        remindAt: source.remindAt,
      });
      expect(source.status).toBe(status);
    },
  );

  it("converts an explicitly changed local time", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    expect(
      reminderFieldsPayload({
        displayName: "Headcount",
        remindAt: "2030-07-03T12:30",
      }).remindAt,
    ).toBe("2030-07-03T19:30:00.000Z");
  });

  it.each(["invalid", "2030-03-10T02:30", "2030-02-30T12:00"])(
    "rejects invalid or normalized local time %s",
    (remindAt) => {
      vi.stubEnv("TZ", "America/New_York");
      expect(() =>
        reminderFieldsPayload({ displayName: "Headcount", remindAt }),
      ).toThrow();
    },
  );
});

describe("quickReminderInstant", () => {
  it("is 9:00 on the given day", () => {
    const at = new Date(quickReminderInstant("2030-07-03", new Date()));
    expect([
      at.getFullYear(),
      at.getMonth(),
      at.getDate(),
      at.getHours(),
      at.getMinutes(),
    ]).toEqual([2030, 6, 3, 9, 0]);
  });

  it("is the next 9:00 without a day: today's while ahead, else tomorrow's", () => {
    const early = new Date(2030, 6, 3, 8, 59);
    const late = new Date(2030, 6, 3, 9, 0);
    expect(quickReminderInstant(null, early)).toBe(
      new Date(2030, 6, 3, 9).toISOString(),
    );
    expect(quickReminderInstant(null, late)).toBe(
      new Date(2030, 6, 4, 9).toISOString(),
    );
  });
});
