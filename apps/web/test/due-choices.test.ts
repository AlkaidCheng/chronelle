import { describe, expect, it } from "vitest";
import {
  describeDueDay,
  describeRepeat,
  describeRepeatShort,
  dueShortcuts,
  dueWeekday,
  exactDueDay,
  parseDueText,
  parseMonthText,
} from "../lib/due-choices";
import { parseDayKey } from "../lib/day-placement";

const at = (key: string) => parseDayKey(key);

describe("due choices", () => {
  it("offers the same four shortcuts every day, with the days they mean", () => {
    // 2030-03-05 is a Tuesday.
    const tuesday = dueShortcuts(at("2030-03-05"));
    expect(tuesday.map(({ id, day }) => [id, day])).toEqual([
      ["today", "2030-03-05"],
      ["tomorrow", "2030-03-06"],
      ["next-week", "2030-03-11"],
      ["next-weekend", "2030-03-09"],
    ]);
    // The weekend runs through its Sunday.
    expect(tuesday.at(-1)?.through).toBe("2030-03-10");
    // Saturday: the coming weekend is a week on; next week is Monday.
    expect(
      dueShortcuts(at("2030-03-09")).map(({ id, day }) => [id, day]),
    ).toEqual([
      ["today", "2030-03-09"],
      ["tomorrow", "2030-03-10"],
      ["next-week", "2030-03-11"],
      ["next-weekend", "2030-03-16"],
    ]);
    // Sunday: next week is tomorrow's Monday; the weekend is the coming Saturday.
    const sunday = dueShortcuts(at("2030-03-10"));
    expect(sunday[2]?.day).toBe("2030-03-11");
    expect(sunday[3]?.day).toBe("2030-03-16");
  });

  it("describes a day as its exact date, with today or tomorrow as a hint", () => {
    const now = at("2030-03-05");
    const exact = (key: string) =>
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(at(key));
    expect(exactDueDay("2030-03-05")).toBe(exact("2030-03-05"));
    expect(describeDueDay("2030-03-05", now)).toBe(
      `${exact("2030-03-05")} (today)`,
    );
    expect(describeDueDay("2030-03-06", now)).toBe(
      `${exact("2030-03-06")} (tomorrow)`,
    );
    expect(describeDueDay("2030-03-21", now)).toBe(exact("2030-03-21"));
    expect(describeDueDay("2031-01-02", now)).toBe(exact("2031-01-02"));
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

  it("reads a typed month and year in several shapes", () => {
    const now = at("2030-03-05");
    expect(parseMonthText("October 2027", now)).toBe("2027-10");
    expect(parseMonthText("oct 2027", now)).toBe("2027-10");
    expect(parseMonthText("2027-10", now)).toBe("2027-10");
    expect(parseMonthText("10/2027", now)).toBe("2027-10");
    expect(parseMonthText("2027 october", now)).toBe("2027-10");
    expect(parseMonthText("October", now)).toBe("2030-10");
    expect(parseMonthText("13/2027", now)).toBeNull();
    expect(parseMonthText("Octember 2027", now)).toBeNull();
    expect(parseMonthText("", now)).toBeNull();
  });

  it("reads a repeat rule for the summary and for a row", () => {
    const exact = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(at("2030-10-31"));
    expect(describeRepeat("weekly")).toBe("every week");
    expect(describeRepeat("biweekly", "2030-10-31")).toBe(
      `every 2 weeks until ${exact}`,
    );
    expect(describeRepeat("")).toBe("");
    expect(describeRepeat("hourly", "2030-10-31")).toBe("");
    expect(describeRepeatShort("weekdays")).toBe("repeats on weekdays");
    expect(describeRepeatShort("monthly")).toBe("repeats monthly");
    expect(describeRepeatShort(null)).toBe("");
  });
});
