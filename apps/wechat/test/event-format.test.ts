import type { EventResponse } from "@chronelle/schemas";
import { describe, expect, it } from "vitest";

import { formatEventSchedule } from "../src/events/format";

const baseEvent: EventResponse = {
  archivedAt: null,
  createdAt: "2030-01-01T00:00:00.000Z",
  createdBy: "00000000-0000-7000-8000-000000000002",
  customProperties: {},
  deletedAt: null,
  description: null,
  displayName: "Summer journey",
  endsAt: null,
  endsOn: null,
  id: "00000000-0000-7000-8000-000000000003",
  isAllDay: false,
  location: null,
  metadata: {},
  objectType: "event",
  permissionScopeId: "00000000-0000-7000-8000-000000000003",
  startsAt: null,
  startsOn: null,
  timezone: null,
  updatedAt: "2030-01-01T00:00:00.000Z",
  version: 3,
  workspaceId: "00000000-0000-7000-8000-000000000001",
};

const preferences = {
  hourCycle: "h23" as const,
  locale: "en-US",
  timeZone: "America/Los_Angeles",
};

const zh = { ...preferences, locale: "zh-CN", timeZone: "Asia/Shanghai" };
const in2030 = new Date("2030-03-01T12:00:00.000Z");
const in2026 = new Date("2026-09-23T12:00:00.000Z");

describe("Event schedule formatting", () => {
  it("keeps calendar-only dates independent from the device time zone", () => {
    expect(
      formatEventSchedule(
        { ...baseEvent, startsOn: "2030-07-01", endsOn: "2030-07-04" },
        preferences,
        in2030,
      ),
    ).toBe("Mon, Jul 1 \u2013 Thu, Jul 4");
  });

  it("names the year only outside the current year", () => {
    expect(
      formatEventSchedule(
        { ...baseEvent, startsOn: "2030-07-01" },
        preferences,
        in2026,
      ),
    ).toBe("Mon, Jul 1, 2030");
    expect(
      formatEventSchedule(
        { ...baseEvent, startsOn: "2026-12-30", endsOn: "2027-01-02" },
        zh,
        in2026,
      ),
    ).toBe("2026年12月30日周三 \u2013 2027年1月2日周六");
  });

  it("writes Chinese dates with their weekday", () => {
    expect(
      formatEventSchedule(
        { ...baseEvent, startsOn: "2026-10-03", endsOn: "2026-10-05" },
        zh,
        in2026,
      ),
    ).toBe("10月3日周六 \u2013 10月5日周一");
  });

  it("gives a same-day timed Event one date and a time span", () => {
    expect(
      formatEventSchedule(
        {
          ...baseEvent,
          startsAt: "2026-11-16T10:00:00.000Z",
          endsAt: "2026-11-16T13:00:00.000Z",
          timezone: "Asia/Shanghai",
        },
        zh,
        in2026,
      ),
    ).toBe("11月16日周一 18:00\u201321:00");
  });

  it("writes both ends of a timed Event that spans days", () => {
    expect(
      formatEventSchedule(
        {
          ...baseEvent,
          startsAt: "2026-10-25T07:00:00.000Z",
          endsAt: "2026-10-27T03:00:00.000Z",
          timezone: "Asia/Shanghai",
        },
        zh,
        in2026,
      ),
    ).toBe("10月25日周日 15:00 \u2013 10月27日周二 11:00");
  });

  it("formats instants in the Event time zone and preferred hour cycle", () => {
    expect(
      formatEventSchedule(
        {
          ...baseEvent,
          startsAt: "2030-07-01T16:30:00.000Z",
          timezone: "America/New_York",
        },
        preferences,
        in2030,
      ),
    ).toBe("Mon, Jul 1, 12:30");
    expect(
      formatEventSchedule(
        {
          ...baseEvent,
          startsAt: "2030-07-01T16:30:00.000Z",
          timezone: "America/New_York",
        },
        { ...preferences, hourCycle: "h12" },
        in2030,
      ),
    ).toBe("Mon, Jul 1, 12:30 PM");
  });

  it("returns no display schedule for an undated Event", () => {
    expect(formatEventSchedule(baseEvent, preferences)).toBeNull();
  });
});
