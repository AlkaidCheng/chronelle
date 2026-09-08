import { describe, expect, it } from "vitest";
import {
  calendarMonthDate,
  selectCalendarRange,
  shiftCalendarDate,
} from "../lib/calendar-range";

describe("calendar range selection", () => {
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
});
