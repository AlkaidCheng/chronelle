import { afterEach, describe, expect, it } from "vitest";
import en from "../messages/en.json";
import { setActiveLocale } from "../i18n/active-locale";
import {
  defaultTimePreferences,
  setActiveTimePreferences,
} from "../i18n/active-preferences";
import {
  dayKeyOf,
  eventDays,
  instantDate,
  instantDay,
  monthDays,
  parseDayKey,
  placeByDay,
  startOfWeek,
  taskDay,
  today,
  weekDays,
} from "../lib/day-placement";

const at = (key: string) => parseDayKey(key);

afterEach(() => {
  setActiveTimePreferences(defaultTimePreferences);
  setActiveLocale("en", en);
});

describe("day placement", () => {
  it("frames weeks from Monday and months across six weeks", () => {
    expect(dayKeyOf(startOfWeek(at("2030-03-06"), 1))).toBe("2030-03-04");
    expect(dayKeyOf(startOfWeek(at("2030-03-04"), 1))).toBe("2030-03-04");
    expect(dayKeyOf(startOfWeek(at("2030-03-03"), 1))).toBe("2030-02-25");
    expect(weekDays(at("2030-03-06"), 1)).toEqual([
      "2030-03-04",
      "2030-03-05",
      "2030-03-06",
      "2030-03-07",
      "2030-03-08",
      "2030-03-09",
      "2030-03-10",
    ]);
    // The weeks run from the one holding the 1st to the one holding the
    // last day: five for a March starting on a Friday, four for a
    // February that fills its weeks, six for a September starting on a
    // Sunday and ending on a Monday.
    const march = monthDays(at("2030-03-15"), 1);
    expect(march).toHaveLength(35);
    expect(march[0]).toBe("2030-02-25");
    expect(march.at(-1)).toBe("2030-03-31");
    const february = monthDays(at("2027-02-10"), 1);
    expect(february).toHaveLength(28);
    expect(february[0]).toBe("2027-02-01");
    expect(february.at(-1)).toBe("2027-02-28");
    const september = monthDays(at("2030-09-16"), 1);
    expect(september).toHaveLength(42);
    expect(september[0]).toBe("2030-08-26");
    expect(september.at(-1)).toBe("2030-10-06");
    // A year end keeps its Monday framing.
    expect(monthDays(at("2030-12-31"), 1)[0]).toBe("2030-11-25");
  });

  it("frames weeks from Sunday when asked, and by default from the language", () => {
    expect(dayKeyOf(startOfWeek(at("2030-03-06"), 7))).toBe("2030-03-03");
    expect(dayKeyOf(startOfWeek(at("2030-03-03"), 7))).toBe("2030-03-03");
    expect(dayKeyOf(startOfWeek(at("2030-03-02"), 7))).toBe("2030-02-24");
    expect(weekDays(at("2030-03-06"), 7)[0]).toBe("2030-03-03");
    // March 2030 starts on a Friday and ends on a Sunday: Sunday-first
    // weeks begin on Feb 24 and the last week is the one March 31 opens.
    const march = monthDays(at("2030-03-15"), 7);
    expect(march).toHaveLength(42);
    expect(march[0]).toBe("2030-02-24");
    expect(march.at(-1)).toBe("2030-04-06");
    // English weeks start on Sunday, Simplified Chinese ones on Monday,
    // unless the account chose a day.
    expect(dayKeyOf(startOfWeek(at("2030-03-06")))).toBe("2030-03-03");
    setActiveLocale("zh-Hans", en);
    expect(dayKeyOf(startOfWeek(at("2030-03-06")))).toBe("2030-03-04");
    setActiveTimePreferences({ ...defaultTimePreferences, weekStart: 7 });
    expect(dayKeyOf(startOfWeek(at("2030-03-06")))).toBe("2030-03-03");
  });

  it("places instants on the day of the account's zone", () => {
    const late = "2030-03-06T23:30:00Z";
    setActiveTimePreferences({ ...defaultTimePreferences, timeZone: "UTC" });
    expect(instantDay(late)).toBe("2030-03-06");
    expect(dayKeyOf(today(new Date(late)))).toBe("2030-03-06");
    setActiveTimePreferences({
      ...defaultTimePreferences,
      timeZone: "Asia/Shanghai",
    });
    expect(instantDay(late)).toBe("2030-03-07");
    expect(dayKeyOf(instantDate(late))).toBe("2030-03-07");
    setActiveTimePreferences({
      ...defaultTimePreferences,
      timeZone: "America/Los_Angeles",
    });
    expect(instantDay(late)).toBe("2030-03-06");
    expect(
      taskDay({ dueOn: null, dueAt: late } as Parameters<typeof taskDay>[0]),
    ).toBe("2030-03-06");
  });

  it("places a task on its due day and a scheduled item on every day it covers", () => {
    const task = (dueOn: string | null, dueAt: string | null) =>
      ({ dueOn, dueAt }) as Parameters<typeof taskDay>[0];
    expect(taskDay(task("2030-03-06", null))).toBe("2030-03-06");
    expect(taskDay(task(null, at("2030-03-06").toISOString()))).toBe(
      "2030-03-06",
    );
    expect(taskDay(task(null, null))).toBeNull();
    const event = (fields: Partial<Parameters<typeof eventDays>[0]>) =>
      ({
        startsOn: null,
        endsOn: null,
        startsAt: null,
        endsAt: null,
        ...fields,
      }) as Parameters<typeof eventDays>[0];
    expect(eventDays(event({ startsOn: "2030-03-06" }))).toEqual([
      "2030-03-06",
    ]);
    expect(
      eventDays(event({ startsOn: "2030-03-30", endsOn: "2030-04-02" })),
    ).toEqual(["2030-03-30", "2030-03-31", "2030-04-01", "2030-04-02"]);
    const evening = new Date(2030, 2, 6, 22, 0).toISOString();
    const morning = new Date(2030, 2, 7, 2, 0).toISOString();
    expect(eventDays(event({ startsAt: evening }))).toEqual(["2030-03-06"]);
    expect(eventDays(event({ startsAt: evening, endsAt: morning }))).toEqual([
      "2030-03-06",
      "2030-03-07",
    ]);
    expect(eventDays(event({}))).toEqual([]);
    const placed = placeByDay(
      [
        { id: "a", days: ["2030-03-06"] },
        { id: "b", days: ["2030-03-06", "2030-03-07"] },
        { id: "c", days: [] },
      ],
      (item) => item.days,
    );
    expect([...placed.keys()]).toEqual(["2030-03-06", "2030-03-07"]);
    expect(placed.get("2030-03-06")?.map(({ id }) => id)).toEqual(["a", "b"]);
  });
});
