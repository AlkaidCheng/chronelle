import { describe, expect, it } from "vitest";
import {
  eventComponentKindSchema,
  type EventComponentKind,
} from "@livtales/schemas";
import {
  eventComponentKinds,
  findEventComponents,
  viewOf,
  viewsOf,
} from "../lib/event-components";

describe("component catalog search", () => {
  it.each(["", "  ", "/"])("lists the full catalog for %j", (query) => {
    expect(findEventComponents(query)).toEqual(eventComponentKinds);
    // Every kind the schema knows is offered.
    expect(eventComponentKinds).toEqual(eventComponentKindSchema.options);
  });

  it("shows an itinerary one day at a time, or every day, by its own view", () => {
    expect(viewsOf("itinerary")).toEqual(["by-day", "list"]);
    expect(viewOf({ kind: "itinerary" })).toBe("by-day");
    expect(viewOf({ kind: "itinerary", view: "list" })).toBe("list");
    // A view the kind does not offer falls back to its default.
    expect(viewOf({ kind: "itinerary", view: "week" })).toBe("by-day");
  });

  it.each<[string, EventComponentKind[]]>([
    [" / CALENDAR ", ["calendar"]],
    ["\uff43\uff41\uff4c\uff45\uff4e\uff44\uff41\uff52", ["calendar"]],
    ["to do", ["todos"]],
    ["checklist", ["todos"]],
    ["running order", ["calendar", "itinerary"]],
    ["itinerary", ["itinerary"]],
    ["day sheet", ["itinerary"]],
    ["costs", ["expenses"]],
    ["documents", ["files"]],
    ["alerts", ["reminders"]],
    ["chronological", ["timeline"]],
    ["not-a-component", []],
  ])(
    "matches %j using names, descriptions, and ordinary terms",
    (query, kinds) => {
      expect(findEventComponents(query)).toEqual(kinds);
    },
  );
});
