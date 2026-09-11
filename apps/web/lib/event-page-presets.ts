import type { EventComponentKind, EventPage } from "@chronelle/schemas";

interface EventPagePreset {
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly description: string;
  readonly components: readonly EventComponentKind[];
}

export const eventPagePresets = [
  {
    id: "blank",
    label: "Blank",
    name: "",
    description: "An empty page. Add only the components you need.",
    components: [],
  },
  {
    id: "gathering",
    label: "Gathering",
    name: "Gathering",
    description: "Prepare, follow the running order, and track spending.",
    components: ["todos", "itinerary", "expenses"],
  },
  {
    id: "multi-day",
    label: "Multi-day",
    name: "Multi-day",
    description: "Keep scheduled activities and useful documents together.",
    components: ["calendar", "itinerary", "files"],
  },
] as const satisfies readonly EventPagePreset[];

/** Create layout identities only; component views use existing event records. */
export function createPresetPage(preset: EventPagePreset): EventPage {
  return {
    id: crypto.randomUUID(),
    name: preset.name,
    components: preset.components.map((kind) => ({
      id: crypto.randomUUID(),
      kind,
    })),
  };
}
