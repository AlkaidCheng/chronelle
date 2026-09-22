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

describe("Event schedule formatting", () => {
  it("keeps calendar-only dates independent from the device time zone", () => {
    expect(
      formatEventSchedule(
        { ...baseEvent, startsOn: "2030-07-01", endsOn: "2030-07-04" },
        preferences,
      ),
    ).toBe("Jul 1, 2030 - Jul 4, 2030");
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
      ),
    ).toContain("12:30");
  });

  it("returns no display schedule for an undated Event", () => {
    expect(formatEventSchedule(baseEvent, preferences)).toBeNull();
  });
});
