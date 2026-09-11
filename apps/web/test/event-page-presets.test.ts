import { describe, expect, it } from "vitest";
import { eventPagesSchema } from "@chronelle/schemas";
import { createPresetPage, eventPagePresets } from "../lib/event-page-presets";

describe("event page presets", () => {
  it.each(eventPagePresets)(
    "creates fresh layout identities for $label",
    (preset) => {
      const first = createPresetPage(preset);
      const second = createPresetPage(preset);
      expect(first.id).not.toBe(second.id);
      expect(first.components.map(({ kind }) => kind)).toEqual(
        preset.components,
      );
      expect(
        eventPagesSchema.parse([
          { ...first, name: "One" },
          { ...second, name: "Two" },
        ]),
      ).toHaveLength(2);
      first.components.pop();
      expect(second.components.map(({ kind }) => kind)).toEqual(
        preset.components,
      );
    },
  );
});
