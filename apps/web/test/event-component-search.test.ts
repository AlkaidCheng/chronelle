import { describe, expect, it } from "vitest";
import {
  eventComponentKindSchema,
  type EventComponentKind,
} from "@chronelle/schemas";
import { findEventComponents } from "../lib/event-components";

describe("component catalog search", () => {
  it.each(["", "  ", "/"])("lists the full catalog for %j", (query) => {
    expect(findEventComponents(query)).toEqual(
      eventComponentKindSchema.options,
    );
  });

  it.each<[string, EventComponentKind[]]>([
    [" / CALENDAR ", ["calendar"]],
    ["\uff43\uff41\uff4c\uff45\uff4e\uff44\uff41\uff52", ["calendar"]],
    ["to do", ["todos"]],
    ["checklist", ["todos"]],
    ["running order", ["itinerary"]],
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
