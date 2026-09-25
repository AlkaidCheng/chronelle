import { describe, expect, it } from "vitest";
import { eventPagesSchema } from "@livtales/schemas";
import { createPresetPage, eventPagePresets } from "../lib/event-page-presets";

describe("event page presets", () => {
  it("names the Calendar's agenda where the Gathering page had an itinerary", () => {
    const gathering = eventPagePresets.find(({ id }) => id === "gathering");
    expect(gathering?.components).toEqual([
      "todos",
      { kind: "calendar", view: "agenda" },
      "expenses",
    ]);
  });

  it.each(eventPagePresets)(
    "creates fresh layout identities for $id",
    (preset) => {
      const first = createPresetPage(preset);
      const second = createPresetPage(preset);
      expect(first.id).not.toBe(second.id);
      const expected = preset.components.map((component) =>
        typeof component === "string" ? { kind: component } : component,
      );
      const shape = ({
        kind,
        view,
      }: {
        kind: string;
        view?: string | undefined;
      }) => (view === undefined ? { kind } : { kind, view });
      expect(first.components.map(shape)).toEqual(expected);
      expect(
        eventPagesSchema.parse([
          { ...first, name: "One" },
          { ...second, name: "Two" },
        ]),
      ).toHaveLength(2);
      first.components.pop();
      expect(second.components.map(shape)).toEqual(expected);
    },
  );
});
