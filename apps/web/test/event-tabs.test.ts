import { describe, expect, it } from "vitest";

import {
  arrangeEventTabs,
  eventTabsPreferenceOf,
  fixedViews,
  galleryViews,
  mergeEventTabs,
  stripViews,
} from "../lib/event-tabs";

const known = ["overview", "todos", "calendar", "files", "sharing"] as const;
const kyoto = "01a0b355-cad8-73d2-89f8-0a12abf666a8";
const lisbon = "01a0b355-cad8-73d2-89f8-0a12abf666a9";
const page1 = "01a0b355-cad8-73d2-89f8-0a12abf66601";
const page2 = "01a0b355-cad8-73d2-89f8-0a12abf66602";

describe("the event tab arrangement", () => {
  it("offers every view but the pages, and never removes a fixed view", () => {
    expect(stripViews).not.toContain("pages");
    expect(galleryViews).not.toContain("overview");
    expect(galleryViews).not.toContain("removed-links");
    for (const view of fixedViews) expect(stripViews).toContain(view);
  });

  it("shows the known views in default order with nothing hidden or removed until arranged", () => {
    expect(arrangeEventTabs({}, known)).toEqual({
      order: known,
      hidden: new Set(),
      removed: new Set(),
    });
  });

  it("keeps the order first, appends views it does not name, leaves removed ones out, and ignores unknown keys", () => {
    expect(
      arrangeEventTabs(
        {
          order: ["files", "notes", "todos"],
          hidden: ["calendar", page1, "notes"],
          removed: ["calendar", "overview", "notes"],
        },
        known,
      ),
    ).toEqual({
      order: ["files", "todos", "overview", "sharing"],
      hidden: new Set(["calendar", page1, "notes"]),
      removed: new Set(["calendar"]),
    });
  });

  it("keeps a preference with the keys the app does not know, and drops a hidden page that is gone", () => {
    const previous = {
      order: ["files", "notes", "todos"],
      hidden: [page1, page2, "notes"],
      removed: ["calendar", "notes"],
    };
    const arranged = arrangeEventTabs(previous, known);
    expect(eventTabsPreferenceOf(arranged, previous, known, [page1])).toEqual({
      order: ["files", "todos", "overview", "sharing", "notes"],
      hidden: [page1, "notes"],
      removed: ["calendar", "notes"],
    });
  });
});

describe("mergeEventTabs", () => {
  it("replaces one event's tabs, drops them with null, and keeps the others", () => {
    const current = {
      [kyoto]: { order: ["todos"] },
      [lisbon]: { hidden: ["files"] },
    };
    expect(mergeEventTabs(current, undefined)).toBe(current);
    expect(
      mergeEventTabs(current, { [kyoto]: { removed: ["calendar"] } }),
    ).toEqual({
      [kyoto]: { removed: ["calendar"] },
      [lisbon]: { hidden: ["files"] },
    });
    expect(mergeEventTabs(current, { [lisbon]: null })).toEqual({
      [kyoto]: { order: ["todos"] },
    });
  });
});
