import { describe, expect, it } from "vitest";
import {
  calendarMonthDate,
  describeCalendarRange,
  selectCalendarRange,
  shiftCalendarDate,
  shiftCalendarMonth,
} from "../lib/calendar-range";

describe("calendar range selection", () => {
  it.each([
    ["", "", "Choose a start date."],
    ["2030-07-03", "", "End date optional."],
    ["2030-07-03", "2030-07-03", "1 day, including start and end dates."],
    ["2030-07-03", "2030-07-12", "10 days, including start and end dates."],
    ["2028-02-28", "2028-03-01", "3 days, including start and end dates."],
    ["2026-03-07", "2026-03-09", "3 days, including start and end dates."],
    ["0001-12-31", "0002-01-01", "2 days, including start and end dates."],
  ])("describes %s through %s", (startDate, endDate, expected) => {
    expect(describeCalendarRange({ startDate, endDate })).toBe(expected);
  });
  it("starts with one day and extends only when choosing an end", () => {
    const single = selectCalendarRange(
      { startDate: "", endDate: "" },
      "2030-07-03",
      false,
    );
    expect(single).toEqual({ startDate: "2030-07-03", endDate: "" });
    expect(selectCalendarRange(single, "2030-07-12", true)).toEqual({
      startDate: "2030-07-03",
      endDate: "2030-07-12",
    });
    expect(selectCalendarRange(single, "2030-07-03", true)).toEqual({
      startDate: "2030-07-03",
      endDate: "2030-07-03",
    });
  });
  it("restarts the range when choosing a new start or an earlier end", () => {
    const range = { startDate: "2030-07-03", endDate: "2030-07-12" };
    expect(selectCalendarRange(range, "2030-07-20", false)).toEqual({
      startDate: "2030-07-20",
      endDate: "",
    });
    expect(selectCalendarRange(range, "2030-07-01", true)).toEqual({
      startDate: "2030-07-01",
      endDate: "",
    });
  });
  it.each([
    ["2028-02-28", 1, "2028-02-29"],
    ["2028-02-29", 1, "2028-03-01"],
    ["2027-02-28", 1, "2027-03-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2030-03-01", -1, "2030-02-28"],
    ["0001-01-01", 1, "0001-01-02"],
  ])("moves %s by %i day(s)", (date, days, expected) => {
    expect(shiftCalendarDate(date, days)).toBe(expected);
  });
  it("preserves four-digit years below 100", () => {
    expect(calendarMonthDate(1, 1)).toBe("0001-01-01");
    expect(calendarMonthDate(99, 12)).toBe("0099-12-01");
  });
  it.each([
    ["2028-01-31", 1, "2028-02-29"],
    ["2027-01-31", 1, "2027-02-28"],
    ["2028-03-31", -1, "2028-02-29"],
    ["2028-02-29", 12, "2029-02-28"],
    ["2028-02-29", -12, "2027-02-28"],
    ["2028-12-31", 1, "2029-01-31"],
    ["0099-12-31", 1, "0100-01-31"],
    ["0001-02-28", -1, "0001-01-28"],
    ["0001-01-01", -1, "0001-01-01"],
    ["9999-12-31", 1, "9999-12-31"],
    ["0001-02-28", -12, "0001-02-28"],
    ["9999-02-28", 12, "9999-02-28"],
  ])(
    "moves %s by %i month(s) within supported dates",
    (date, months, expected) => {
      expect(shiftCalendarMonth(date, months)).toBe(expected);
    },
  );
});
