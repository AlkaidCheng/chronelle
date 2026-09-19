import { describe, expect, it } from "vitest";
import type { EventPage } from "@chronelle/schemas";
import {
  moveEventComponent,
  moveEventPage,
  setEventComponentView,
} from "../lib/event-layout";

function fixture(): EventPage[] {
  return [
    {
      id: "work",
      name: "Work",
      components: [
        { id: "a", kind: "todos" },
        { id: "b", kind: "calendar" },
        { id: "c", kind: "todos" },
      ],
    },
    { id: "day", name: "Day", components: [] },
    { id: "later", name: "Later", components: [{ id: "d", kind: "files" }] },
  ];
}

describe("event layout moves", () => {
  it("reorders pages without changing their identity or contents", () => {
    const pages = fixture();
    const moved = moveEventPage(pages, "work", "later");
    expect(moved.map((page) => page.id)).toEqual(["day", "work", "later"]);
    expect(moved[1]).toBe(pages[0]);
    expect(moveEventPage(moved, "day", null).map((page) => page.id)).toEqual([
      "work",
      "later",
      "day",
    ]);
    expect(pages.map((page) => page.id)).toEqual(["work", "day", "later"]);
  });

  it("reorders duplicate kinds by instance ID and preserves unchanged references", () => {
    const pages = fixture();
    const moved = moveEventComponent(pages, "c", "work", "a");
    expect(moved[0]?.components.map((item) => item.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(moved[0]?.components[0]).toBe(pages[0]?.components[2]);
    expect(moved[1]).toBe(pages[1]);
    expect(moveEventComponent(moved, "c", "work", null)[0]?.components).toEqual(
      pages[0]?.components,
    );
  });

  it("moves between empty and populated pages without copying components", () => {
    const pages = fixture();
    const moved = moveEventComponent(pages, "b", "day", null);
    expect(moved[0]?.components.map((item) => item.id)).toEqual(["a", "c"]);
    expect(moved[1]?.components[0]).toBe(pages[0]?.components[1]);
    expect(
      moveEventComponent(moved, "b", "later", "d")[2]?.components.map(
        (item) => item.id,
      ),
    ).toEqual(["b", "d"]);
    expect(pages[1]?.components).toEqual([]);
  });

  it("returns the original layout for no-ops, missing IDs, and full destinations", () => {
    const pages = fixture();
    for (const [id, target, before] of [
      ["a", "work", "a"],
      ["a", "work", "b"],
      ["c", "work", null],
      ["missing", "work", null],
      ["a", "missing", null],
      ["a", "work", "missing"],
      ["a", "day", "missing"],
    ] as const)
      expect(moveEventComponent(pages, id, target, before)).toBe(pages);
    expect(moveEventPage(pages, "work", "day")).toBe(pages);
    expect(moveEventPage(pages, "missing", null)).toBe(pages);
    expect(moveEventPage(pages, "work", "missing")).toBe(pages);
    const full = pages.map((page) =>
      page.id === "day"
        ? {
            ...page,
            components: Array.from({ length: 20 }, (_, i) => ({
              id: `full-${i}`,
              kind: "todos" as const,
            })),
          }
        : page,
    );
    expect(moveEventComponent(full, "a", "day", null)).toBe(full);
  });

  it("records a component's view and leaves the rest of the layout shared", () => {
    const pages = fixture();
    const changed = setEventComponentView(pages, "c", "by-day");
    expect(changed[0]?.components[2]).toEqual({
      id: "c",
      kind: "todos",
      view: "by-day",
    });
    expect(changed[0]?.components[0]).toBe(pages[0]?.components[0]);
    expect(changed[1]).toBe(pages[1]);
    expect(setEventComponentView(changed, "c", "by-day")).toBe(changed);
    expect(setEventComponentView(pages, "missing", "by-day")).toBe(pages);
    expect(
      setEventComponentView(changed, "c", "list")[0]?.components[2],
    ).toEqual({ id: "c", kind: "todos", view: "list" });
    // An itinerary saved before it had views of its own keeps its kind.
    const legacy: EventPage[] = [
      {
        id: "p",
        name: "Plan",
        components: [{ id: "i", kind: "itinerary" }],
      },
    ];
    expect(setEventComponentView(legacy, "i", "list")[0]?.components).toEqual([
      { id: "i", kind: "itinerary", view: "list" },
    ]);
    expect(legacy[0]?.components[0]).toEqual({ id: "i", kind: "itinerary" });
  });
});
