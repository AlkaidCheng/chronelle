import { describe, expect, it } from "vitest";
import {
  describeDueDay,
  dueShortcuts,
  dueWeekday,
  parseDueText,
} from "../lib/due-choices";
import { parseDayKey } from "../lib/day-placement";

const at = (key: string) => parseDayKey(key);

describe("due choices", () => {
  it("offers the shortcuts a weekday allows, with the days they mean", () => {
    // 2030-03-05 is a Tuesday.
    const tuesday = dueShortcuts(at("2030-03-05"), null);
    expect(tuesday.map(({ id, day }) => [id, day])).toEqual([
      ["today", "2030-03-05"],
      ["tomorrow", "2030-03-06"],
      ["later-this-week", "2030-03-07"],
      ["weekend", "2030-03-09"],
      ["next-week", "2030-03-11"],
    ]);
    // Today drops out once it is the choice.
    expect(dueShortcuts(at("2030-03-05"), "2030-03-05")[0]?.id).toBe(
      "tomorrow",
    );
    // Thursday: two days on is Saturday, so no Later this week.
    expect(dueShortcuts(at("2030-03-07"), null).map(({ id }) => id)).toEqual([
      "today",
      "tomorrow",
      "weekend",
      "next-week",
    ]);
    // Saturday: no weekend shortcut; next week is Monday.
    expect(
      dueShortcuts(at("2030-03-09"), null).map(({ id, day }) => [id, day]),
    ).toEqual([
      ["today", "2030-03-09"],
      ["tomorrow", "2030-03-10"],
      ["next-week", "2030-03-11"],
    ]);
    // Sunday: next week is tomorrow's Monday.
    expect(dueShortcuts(at("2030-03-10"), null).at(-1)?.day).toBe("2030-03-11");
  });

  it("describes a day as Today, Tomorrow, or its date, with the year when far", () => {
    const now = at("2030-03-05");
    expect(describeDueDay("2030-03-05", now)).toBe("Today");
    expect(describeDueDay("2030-03-06", now)).toBe("Tomorrow");
    expect(describeDueDay("2030-03-21", now)).toBe(
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
      }).format(at("2030-03-21")),
    );
    expect(describeDueDay("2031-01-02", now)).toMatch(/2031/);
    expect(dueWeekday("2030-03-05")).toBe(
      new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(
        at("2030-03-05"),
      ),
    );
  });

  it("reads typed dates in several shapes and refuses the rest", () => {
    const now = at("2030-03-05");
    expect(parseDueText("today", now)).toBe("2030-03-05");
    expect(parseDueText(" Tomorrow ", now)).toBe("2030-03-06");
    expect(parseDueText("next week", now)).toBe("2030-03-11");
    expect(parseDueText("2030-04-01", now)).toBe("2030-04-01");
    expect(parseDueText("Sep 21", now)).toBe("2030-09-21");
    expect(parseDueText("21 september", now)).toBe("2030-09-21");
    expect(parseDueText("Sep 21, 2031", now)).toBe("2031-09-21");
    expect(parseDueText("9/21", now)).toBe("2030-09-21");
    expect(parseDueText("1/2/31", now)).toBe("2031-01-02");
    // A month and day already past this year means next year.
    expect(parseDueText("Jan 2", now)).toBe("2031-01-02");
    // February 29 rolls to a leap year (2032), not to March.
    expect(parseDueText("Feb 29", now)).toBe("2032-02-29");
    expect(parseDueText("2030-02-30", now)).toBeNull();
    expect(parseDueText("Sometime", now)).toBeNull();
    expect(parseDueText("", now)).toBeNull();
  });
});
