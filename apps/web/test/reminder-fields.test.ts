import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
