import { describe, expect, it } from "vitest";
import {
  dayKeyOf,
  eventDays,
  monthDays,
  parseDayKey,
  placeByDay,
  startOfWeek,
  taskDay,
  weekDays,
} from "../lib/day-placement";

const at = (key: string) => parseDayKey(key);

describe("day placement", () => {
  it("frames weeks from Monday and months across six weeks", () => {
    expect(dayKeyOf(startOfWeek(at("2030-03-06")))).toBe("2030-03-04");
    expect(dayKeyOf(startOfWeek(at("2030-03-04")))).toBe("2030-03-04");
    expect(dayKeyOf(startOfWeek(at("2030-03-03")))).toBe("2030-02-25");
    expect(weekDays(at("2030-03-06"))).toEqual([
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
    const march = monthDays(at("2030-03-15"));
    expect(march).toHaveLength(35);
    expect(march[0]).toBe("2030-02-25");
    expect(march.at(-1)).toBe("2030-03-31");
    const february = monthDays(at("2027-02-10"));
    expect(february).toHaveLength(28);
    expect(february[0]).toBe("2027-02-01");
    expect(february.at(-1)).toBe("2027-02-28");
    const september = monthDays(at("2030-09-16"));
    expect(september).toHaveLength(42);
    expect(september[0]).toBe("2030-08-26");
    expect(september.at(-1)).toBe("2030-10-06");
    // A year end keeps its Monday framing.
    expect(monthDays(at("2030-12-31"))[0]).toBe("2030-11-25");
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
