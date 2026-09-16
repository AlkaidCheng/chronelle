import { describe, expect, it } from "vitest";
import { nextTaskDueAt, nextTaskDueDate, taskDueDate } from "../src/index.js";

describe("task repeat", () => {
  it.each([
    ["2030-03-05", "daily", "2030-03-06"],
    ["2030-03-07", "weekdays", "2030-03-08"],
    ["2030-03-08", "weekdays", "2030-03-11"],
    ["2030-03-09", "weekdays", "2030-03-11"],
    ["2030-03-05", "weekly", "2030-03-12"],
    ["2030-03-05", "biweekly", "2030-03-19"],
    ["2030-01-31", "monthly", "2030-02-28"],
    ["2028-01-31", "monthly", "2028-02-29"],
    ["2030-12-15", "monthly", "2031-01-15"],
    ["2028-02-29", "yearly", "2029-02-28"],
    ["2030-12-31", "yearly", "2031-12-31"],
  ] as const)("moves %s %s to %s", (due, rule, expected) => {
    expect(nextTaskDueDate(due, rule)).toBe(expected);
  });

  it("advances an instant by its UTC date and keeps its time", () => {
    expect(
      nextTaskDueAt(
        new Date("2030-03-05T23:30:00.000Z"),
        "daily",
      ).toISOString(),
    ).toBe("2030-03-06T23:30:00.000Z");
    expect(
      nextTaskDueAt(
        new Date("2030-01-31T09:00:00.000Z"),
        "monthly",
      ).toISOString(),
    ).toBe("2030-02-28T09:00:00.000Z");
  });

  it("reads the due date of a date or an instant", () => {
    expect(taskDueDate("2030-03-05", null)).toBe("2030-03-05");
    expect(taskDueDate(null, new Date("2030-03-05T23:30:00.000Z"))).toBe(
      "2030-03-05",
    );
    expect(taskDueDate(null, null)).toBeNull();
  });
});
