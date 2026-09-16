import { describe, expect, it } from "vitest";
import { dayGroupLabel, groupByDay } from "../lib/day-groups";
import { dayKeyOf, parseDayKey } from "../lib/day-placement";

describe("day groups", () => {
  it("names today and tomorrow, shows the weekday, and adds the year to a far day", () => {
    const now = parseDayKey("2030-03-06");
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" });
    expect(dayGroupLabel("2030-03-06", now)).toEqual({
      label: [
        new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
        }).format(now),
        "Today",
        weekday.format(now),
      ],
      tone: "today",
    });
    expect(dayGroupLabel("2030-03-07", now).label[1]).toBe("Tomorrow");
    expect(dayGroupLabel("2030-03-07", now).tone).toBe("plain");
    expect(dayGroupLabel("2031-01-01", now).label).toEqual([
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(parseDayKey("2031-01-01")),
      weekday.format(parseDayKey("2031-01-01")),
    ]);
  });

  it("groups items under their days in date order and keeps their order within a day", () => {
    const now = new Date();
    const today = dayKeyOf(now);
    const groups = groupByDay(
      [
        { id: "later", day: "2030-03-07" },
        { id: "first", day: "2030-03-06" },
        { id: "second", day: "2030-03-06" },
        { id: "none", day: null },
        { id: "now", day: today },
      ],
      (item) => item.day,
      now,
    );
    expect(groups.map((group) => group.key)).toEqual(
      [today, "2030-03-06", "2030-03-07"].sort(),
    );
    expect(
      groups
        .find((group) => group.key === "2030-03-06")
        ?.items.map(({ id }) => id),
    ).toEqual(["first", "second"]);
    expect(groups.find((group) => group.key === today)?.tone).toBe("today");
    expect(
      groups.flatMap((group) => group.items).some(({ id }) => id === "none"),
    ).toBe(false);
  });
});
