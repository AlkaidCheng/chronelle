import { describe, expect, it } from "vitest";
import { parseDayKey } from "../lib/day-placement";
import { boardColumns } from "../features/events/period-view";

const item = (id: string) => ({ id });
const today = parseDayKey("2030-03-06");

describe("board columns", () => {
  it("shows Overdue and Today first, then only the days that hold something", () => {
    const placed = new Map([
      ["2030-03-01", [item("late"), item("finished")]],
      ["2030-03-06", [item("now")]],
      ["2030-03-09", [item("soon")]],
      ["2030-04-02", [item("far")]],
    ]);
    const columns = boardColumns({
      overdue: [item("late")],
      overdueLabel: "Overdue",
      placed,
      today,
      undated: [item("someday")],
      undatedLabel: "No due date",
    });
    expect(
      columns.map(({ key, tone, items }) => [
        key,
        tone,
        items.map(({ id }) => id),
      ]),
    ).toEqual([
      ["overdue", "overdue", ["late"]],
      ["2030-03-06", "today", ["now"]],
      ["2030-03-01", "plain", ["finished"]],
      ["2030-03-09", "plain", ["soon"]],
      ["2030-04-02", "plain", ["far"]],
      ["undated", "undated", ["someday"]],
    ]);
    expect(columns[0]?.label).toBe("Overdue");
    expect(columns.at(-1)?.label).toBe("No due date");
  });

  it("keeps Today even when empty and leaves out Overdue and the undated when they are", () => {
    const columns = boardColumns({
      placed: new Map([["2030-03-09", [item("soon")]]]),
      today,
      undatedLabel: "No due date",
    });
    expect(columns.map(({ key, day }) => [key, day])).toEqual([
      ["2030-03-06", "2030-03-06"],
      ["2030-03-09", "2030-03-09"],
    ]);
    expect(columns[0]?.items).toEqual([]);
  });

  it("drops a past day whose only items are overdue", () => {
    const columns = boardColumns({
      overdue: [item("late")],
      overdueLabel: "Overdue",
      placed: new Map([["2030-03-01", [item("late")]]]),
      today,
      undatedLabel: "No due date",
    });
    expect(columns.map(({ key }) => key)).toEqual(["overdue", "2030-03-06"]);
  });
});
