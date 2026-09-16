import { describe, expect, it } from "vitest";
import {
  formatDatePart,
  formatDateTime,
  formatDuration,
  fromDateTimeInput,
  toDateTimeInput,
} from "../lib/format";
import { formatCalendarDate } from "../lib/event-schedule";
import { formatTaskDue, formatTaskTime, formatTaskWhen } from "../lib/task-due";

describe("date input conversion", () => {
  it("keeps an unscheduled value empty", () => {
    expect(toDateTimeInput(null)).toBe("");
    expect(fromDateTimeInput("")).toBeNull();
  });

  it.each([0, 6, 11])("round-trips local wall time in month %s", (month) => {
    const local = new Date(2026, month, 15, 14, 35);
    const input = `2026-${String(month + 1).padStart(2, "0")}-15T14:35`;
    expect(toDateTimeInput(local.toISOString())).toBe(input);
    expect(fromDateTimeInput(input)).toBe(local.toISOString());
  });

  it("keeps the input's existing minute precision", () => {
    const local = new Date(2026, 8, 7, 14, 35, 59, 999);
    expect(toDateTimeInput(local.toISOString())).toBe("2026-09-07T14:35");
  });
});

describe("date display", () => {
  it("marks an unscheduled date", () => {
    expect(formatDateTime(null)).toBe("Not scheduled");
  });

  it.each(["2026-03-01T00:30:00Z", "2026-12-31T23:30:00-05:00"])(
    "formats %s in the runtime's locale and timezone",
    (value) => {
      expect(formatDateTime(value)).toBe(
        new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(value)),
      );
    },
  );

  it("rejects invalid dates rather than displaying an unscheduled value", () => {
    expect(() => formatDateTime("invalid")).toThrow(RangeError);
    expect(() => toDateTimeInput("invalid")).toThrow(RangeError);
    expect(() => fromDateTimeInput("invalid")).toThrow(RangeError);
  });
});

describe("date badge parts", () => {
  it("uses the existing placeholders for an unscheduled badge", () => {
    expect(formatDatePart(null, "month")).toBe("TBD");
    expect(formatDatePart(null, "day")).toBe("-");
  });

  it.each(["2026-03-01T00:30:00Z", "2026-12-31T23:30:00-05:00"])(
    "formats both parts of %s using current locale and timezone defaults",
    (value) => {
      expect(formatDatePart(value, "month")).toBe(
        new Intl.DateTimeFormat(undefined, { month: "short" }).format(
          new Date(value),
        ),
      );
      expect(formatDatePart(value, "day")).toBe(
        new Intl.DateTimeFormat(undefined, { day: "2-digit" }).format(
          new Date(value),
        ),
      );
    },
  );

  it("rejects invalid timestamps", () => {
    expect(() => formatDatePart("invalid", "month")).toThrow(RangeError);
    expect(() => formatDatePart("invalid", "day")).toThrow(RangeError);
  });
});

describe("durations", () => {
  it("reads minutes, whole hours, and hours with minutes", () => {
    expect(formatDuration(15)).toBe("15 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(90)).toBe("1 h 30 min");
    expect(formatDuration(1440)).toBe("24 h");
  });

  it("follows a task's time and never a date-only due", () => {
    const dueAt = "2030-03-05T09:30:00.000Z";
    const time = new Intl.DateTimeFormat(undefined, {
      timeStyle: "short",
    }).format(new Date(dueAt));
    expect(formatTaskTime({ dueAt, durationMinutes: 30 }, false)).toBe(
      `${time}, 30 min`,
    );
    expect(formatTaskTime({ dueAt, durationMinutes: null }, false)).toBe(time);
    expect(
      formatTaskDue({
        dueOn: null,
        dueAt,
        durationMinutes: 90,
        repeatRule: null,
      }),
    ).toBe(`${formatDateTime(dueAt)}, 1 h 30 min`);
    expect(
      formatTaskDue({
        dueOn: "2030-03-05",
        dueAt: null,
        durationMinutes: null,
        repeatRule: "yearly",
      }),
    ).toBe(`${formatCalendarDate("2030-03-05")} \u00b7 repeats yearly`);
  });

  it("says when a task is due and how it repeats, or nothing", () => {
    const dueAt = "2030-03-05T09:30:00.000Z";
    const time = new Intl.DateTimeFormat(undefined, {
      timeStyle: "short",
    }).format(new Date(dueAt));
    expect(
      formatTaskWhen(
        { dueOn: null, dueAt, durationMinutes: null, repeatRule: "weekly" },
        false,
      ),
    ).toBe(`${time} \u00b7 repeats weekly`);
    expect(
      formatTaskWhen(
        {
          dueOn: "2030-03-05",
          dueAt: null,
          durationMinutes: null,
          repeatRule: "daily",
        },
        false,
      ),
    ).toBe("repeats daily");
    expect(
      formatTaskWhen(
        {
          dueOn: "2030-03-05",
          dueAt: null,
          durationMinutes: null,
          repeatRule: null,
        },
        false,
      ),
    ).toBe("");
  });
});
