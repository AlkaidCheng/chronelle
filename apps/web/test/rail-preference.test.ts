import { describe, expect, it } from "vitest";

import { moveKey, placeKey } from "../lib/key-order";
import { arrangeRail, railPreferenceOf } from "../lib/rail-preference";

const known = ["events", "tasks", "people"];

describe("the rail arrangement", () => {
  it("shows every known collection in default order with nothing hidden until arranged", () => {
    expect(arrangeRail({}, known)).toEqual({
      order: known,
      hidden: new Set(),
    });
  });

  it("keeps the account's order, appends collections it does not name, and ignores keys the app lacks", () => {
    expect(
      arrangeRail(
        {
          order: ["people", "reminders", "events"],
          hidden: ["tasks", "files"],
        },
        known,
      ),
    ).toEqual({
      order: ["people", "events", "tasks"],
      hidden: new Set(["tasks"]),
    });
  });

  it("writes the arrangement back with the keys it does not know carried as they were", () => {
    expect(
      railPreferenceOf(
        { order: ["tasks", "events", "people"], hidden: new Set(["people"]) },
        { order: ["reminders", "events"], hidden: ["files"] },
        known,
      ),
    ).toEqual({
      order: ["tasks", "events", "people", "reminders"],
      hidden: ["people", "files"],
    });
  });

  it("moves a key by steps, clamped to the ends, and places one before another or last", () => {
    expect(moveKey(known, "people", -1)).toEqual(["events", "people", "tasks"]);
    expect(moveKey(known, "people", -5)).toEqual(["people", "events", "tasks"]);
    expect(moveKey(known, "people", 1)).toBe(known);
    expect(moveKey(known, "missing", 1)).toBe(known);
    expect(placeKey(known, "people", "events")).toEqual([
      "people",
      "events",
      "tasks",
    ]);
    expect(placeKey(known, "events", null)).toEqual([
      "tasks",
      "people",
      "events",
    ]);
    expect(placeKey(known, "events", "events")).toBe(known);
  });
});
