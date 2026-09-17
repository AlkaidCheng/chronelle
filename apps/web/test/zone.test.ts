import { afterEach, describe, expect, it } from "vitest";

import {
  activeWeekStart,
  defaultTimePreferences,
  instantOptions,
  setActiveTimePreferences,
  shownTimeZone,
} from "../i18n/active-preferences";
import {
  formatDateTime,
  formatTime,
  fromDateTimeInput,
  toDateTimeInput,
} from "../lib/format";
import { quickReminderInstant } from "../lib/reminder-fields";
import { instantOnDay } from "../lib/task-due";
import {
  instantDayKey,
  isKnownTimeZone,
  wallClock,
  wallInstant,
  zoneOffsetLabel,
} from "../lib/zone";

const withZone = (timeZone: string | null) =>
  setActiveTimePreferences({ ...defaultTimePreferences, timeZone });

afterEach(() => setActiveTimePreferences(defaultTimePreferences));

describe("wall clocks in a zone", () => {
  it("reads an instant on the wall of the zone and names its day", () => {
    const instant = new Date("2030-03-06T23:30:00Z");
    expect(wallClock(instant, "UTC")).toEqual({
      year: 2030,
      month: 3,
      day: 6,
      hour: 23,
      minute: 30,
      second: 0,
    });
    expect(wallClock(instant, "Asia/Shanghai")).toMatchObject({
      day: 7,
      hour: 7,
      minute: 30,
    });
    expect(wallClock(instant, "America/Los_Angeles")).toMatchObject({
      day: 6,
      hour: 15,
    });
    expect(instantDayKey(instant, "Asia/Shanghai")).toBe("2030-03-07");
    expect(instantDayKey("2030-03-06T23:30:00Z", "UTC")).toBe("2030-03-06");
    // Midnight reads as hour 0, never 24.
    expect(wallClock(new Date("2030-03-07T00:00:00Z"), "UTC").hour).toBe(0);
  });

  it("turns a wall clock back into the instant it names, across a clock change", () => {
    expect(
      wallInstant(
        { year: 2030, month: 3, day: 7, hour: 7, minute: 30 },
        "Asia/Shanghai",
      ).toISOString(),
    ).toBe("2030-03-06T23:30:00.000Z");
    expect(
      wallInstant(
        { year: 2030, month: 3, day: 6, hour: 23, minute: 30 },
        "UTC",
      ).toISOString(),
    ).toBe("2030-03-06T23:30:00.000Z");
    // New York moves its clocks forward on 2030-03-10 at 02:00: 01:30 is
    // still standard time, 03:30 already daylight time.
    expect(
      wallInstant(
        { year: 2030, month: 3, day: 10, hour: 1, minute: 30 },
        "America/New_York",
      ).toISOString(),
    ).toBe("2030-03-10T06:30:00.000Z");
    expect(
      wallInstant(
        { year: 2030, month: 3, day: 10, hour: 3, minute: 30 },
        "America/New_York",
      ).toISOString(),
    ).toBe("2030-03-10T07:30:00.000Z");
    // A round trip through the wall keeps the instant.
    for (const iso of [
      "2030-11-03T05:30:00.000Z",
      "2030-07-01T12:00:00.000Z",
      "2029-12-31T23:59:00.000Z",
    ])
      for (const zone of ["America/New_York", "Australia/Sydney", "UTC"])
        expect(
          wallInstant(wallClock(new Date(iso), zone), zone).toISOString(),
        ).toBe(iso);
  });

  it("knows the zones the runtime knows and labels their offsets", () => {
    expect(isKnownTimeZone("Asia/Shanghai")).toBe(true);
    expect(isKnownTimeZone("UTC")).toBe(true);
    expect(isKnownTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(
      zoneOffsetLabel("Asia/Shanghai", new Date("2030-03-06T00:00Z")),
    ).toBe("UTC+08:00");
    expect(
      zoneOffsetLabel("America/St_Johns", new Date("2030-01-06T00:00Z")),
    ).toBe("UTC-03:30");
    expect(zoneOffsetLabel("UTC")).toBe("UTC+00:00");
  });
});

describe("the account's zone and clock in the helpers", () => {
  it("formats instants in the chosen zone and clock", () => {
    const instant = "2030-03-06T23:30:00Z";
    setActiveTimePreferences({
      timeZone: "Asia/Shanghai",
      hourCycle: "h23",
      weekStart: null,
    });
    expect(formatDateTime(instant)).toBe("Mar 7, 2030, 07:30");
    expect(formatTime(instant)).toBe("07:30");
    setActiveTimePreferences({
      timeZone: "Asia/Shanghai",
      hourCycle: "h12",
      weekStart: null,
    });
    expect(formatTime(instant)).toBe("7:30 AM");
    setActiveTimePreferences({
      timeZone: "America/Los_Angeles",
      hourCycle: null,
      weekStart: null,
    });
    expect(formatDateTime(instant)).toBe("Mar 6, 2030, 3:30 PM");
    expect(instantOptions()).toEqual({ timeZone: "America/Los_Angeles" });
    expect(shownTimeZone()).toBe("America/Los_Angeles");
    expect(activeWeekStart("en")).toBe(7);
    expect(activeWeekStart("zh-Hans")).toBe(1);
  });

  it("reads and writes datetime-local values on the zone's wall", () => {
    withZone("Asia/Shanghai");
    expect(toDateTimeInput("2030-03-06T23:30:00Z")).toBe("2030-03-07T07:30");
    expect(fromDateTimeInput("2030-03-07T07:30")).toBe(
      "2030-03-06T23:30:00.000Z",
    );
    expect(fromDateTimeInput("")).toBeNull();
    withZone("UTC");
    expect(toDateTimeInput("2030-03-06T23:30:00Z")).toBe("2030-03-06T23:30");
    expect(fromDateTimeInput("2030-03-06T23:30")).toBe(
      "2030-03-06T23:30:00.000Z",
    );
  });

  it("moves an instant to another day at the same wall time of the zone", () => {
    withZone("Asia/Shanghai");
    expect(instantOnDay("2030-03-06T23:30:00Z", "2030-03-20")).toBe(
      "2030-03-19T23:30:00.000Z",
    );
    withZone("America/New_York");
    // 09:00 New York on March 9 is standard time, on March 11 daylight time.
    expect(instantOnDay("2030-03-09T14:00:00Z", "2030-03-11")).toBe(
      "2030-03-11T13:00:00.000Z",
    );
  });

  it("puts a quick reminder at 9:00 of the zone", () => {
    withZone("Asia/Shanghai");
    expect(
      quickReminderInstant("2030-03-07", new Date("2030-03-01T00:00Z")),
    ).toBe("2030-03-07T01:00:00.000Z");
    // At 07:30 in Shanghai today's 9:00 is ahead; at 10:00 it is tomorrow's.
    expect(quickReminderInstant(null, new Date("2030-03-06T23:30:00Z"))).toBe(
      "2030-03-07T01:00:00.000Z",
    );
    expect(quickReminderInstant(null, new Date("2030-03-07T02:00:00Z"))).toBe(
      "2030-03-08T01:00:00.000Z",
    );
  });
});
