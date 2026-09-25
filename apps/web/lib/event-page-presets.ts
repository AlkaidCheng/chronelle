import type {
  EventComponentKind,
  EventComponentView,
  EventPage,
} from "@livtales/schemas";
import { tr } from "../i18n/active-locale";
import { newId } from "./new-id";

export type EventPagePresetId = "blank" | "gathering" | "multi-day";

interface EventPagePreset {
  readonly id: EventPagePresetId;
  /** The components in order; a kind alone takes its default view. */
  readonly components: readonly (
    | EventComponentKind
    | { readonly kind: EventComponentKind; readonly view: EventComponentView }
  )[];
}

export const eventPagePresets = [
  { id: "blank", components: [] },
  {
    id: "gathering",
    components: ["todos", { kind: "calendar", view: "agenda" }, "expenses"],
  },
  { id: "multi-day", components: ["calendar", "files"] },
] as const satisfies readonly EventPagePreset[];

const presetKeys = {
  blank: "blank",
  gathering: "gathering",
  "multi-day": "multiDay",
} as const satisfies Record<EventPagePresetId, string>;

/** A preset's name on the chooser, in the active language. */
export function presetLabel(id: EventPagePresetId): string {
  return tr("pagePresets.labels")(presetKeys[id]);
}

/** What a preset sets up, in the active language. */
export function presetDescription(id: EventPagePresetId): string {
  return tr("pagePresets.descriptions")(presetKeys[id]);
}

/** The page name a preset starts with: its label, or none for a blank page. */
export function presetPageName(id: EventPagePresetId): string {
  return id === "blank" ? "" : presetLabel(id);
}

/** Create layout identities only; component views use existing event records. */
export function createPresetPage(preset: EventPagePreset): EventPage {
  return {
    id: newId(),
    name: presetPageName(preset.id),
    components: preset.components.map((component) =>
      typeof component === "string"
        ? { id: newId(), kind: component }
        : { id: newId(), ...component },
    ),
  };
}
