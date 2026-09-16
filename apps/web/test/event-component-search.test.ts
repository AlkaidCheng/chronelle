import { describe, expect, it } from "vitest";
import {
  eventComponentKindSchema,
  type EventComponentKind,
} from "@chronelle/schemas";
import {
  addableEventComponentKinds,
  findEventComponents,
  resolveEventComponent,
  viewOf,
  viewsOf,
} from "../lib/event-components";

describe("component catalog search", () => {
  it.each(["", "  ", "/"])("lists the full catalog for %j", (query) => {
    expect(findEventComponents(query)).toEqual(addableEventComponentKinds);
    // Every kind the schema knows is either offered or the retired alias.
    expect(
      eventComponentKindSchema.options.filter(
        (kind) => !addableEventComponentKinds.includes(kind),
      ),
    ).toEqual(["itinerary"]);
  });

  it("renders a saved itinerary as the Calendar's agenda", () => {
    expect(resolveEventComponent({ kind: "itinerary" })).toEqual({
      kind: "calendar",
      view: "agenda",
    });
    expect(viewOf({ kind: "itinerary", view: "list" })).toBe("agenda");
    expect(viewsOf("itinerary")).toEqual(viewsOf("calendar"));
    expect(resolveEventComponent({ kind: "calendar", view: "week" })).toEqual({
      kind: "calendar",
      view: "week",
    });
  });

  it.each<[string, EventComponentKind[]]>([
    [" / CALENDAR ", ["calendar"]],
    ["\uff43\uff41\uff4c\uff45\uff4e\uff44\uff41\uff52", ["calendar"]],
    ["to do", ["todos"]],
    ["checklist", ["todos"]],
    ["running order", ["calendar"]],
    ["itinerary", ["calendar"]],
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
