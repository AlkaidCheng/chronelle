import { describe, expect, it } from "vitest";
import {
  eventSchedulePayload,
  formatCalendarDate,
  readEventSchedule,
} from "../lib/event-schedule";
import { eventPeriod } from "../lib/event-collection";

describe("event scheduling", () => {
  it("keeps date-only intervals inclusive without inventing instants", () => {
    expect(
      eventSchedulePayload({
        ...readEventSchedule(),
        mode: "dates",
        startDate: "2028-02-29",
        endDate: "2028-03-04",
      }),
    ).toEqual({
      startsOn: "2028-02-29",
      endsOn: "2028-03-04",
      startsAt: null,
      endsAt: null,
    });
    expect(formatCalendarDate("2028-02-29")).toBe(
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date("2028-02-29T00:00:00Z")),
    );
  });
  it.each(["2027-02-29", "0000-01-01", "2026-13-01"])(
    "rejects invalid date %s",
    (startDate) => {
      expect(() =>
        eventSchedulePayload({
          ...readEventSchedule(),
          mode: "dates",
          startDate,
        }),
      ).toThrow();
    },
  );
  it("validates complete ordered timed intervals", () => {
    const draft = {
      ...readEventSchedule(),
      mode: "timed" as const,
      startDate: "2030-07-03",
      startTime: "10:00",
      endDate: "2030-07-12",
      endTime: "18:00",
    };
    expect(eventSchedulePayload(draft).endsAt).toBe(
      new Date("2030-07-12T18:00").toISOString(),
    );
    expect(() => eventSchedulePayload({ ...draft, endTime: "" })).toThrow(
      "both",
    );
    expect(() =>
      eventSchedulePayload({ ...draft, endDate: "2030-07-02" }),
    ).toThrow("precede");
  });
  it("uses the full inclusive last day in the event timezone", () => {
    const event = {
      startsAt: null,
      endsAt: null,
      startsOn: "2030-07-03",
      endsOn: "2030-07-12",
      timezone: "America/Los_Angeles",
    };
    expect(eventPeriod(event, Date.parse("2030-07-13T06:59:00Z"))).toBe(
      "upcoming",
    );
    expect(eventPeriod(event, Date.parse("2030-07-13T07:00:00Z"))).toBe("past");
  });
});
