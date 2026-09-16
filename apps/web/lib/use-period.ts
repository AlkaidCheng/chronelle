"use client";

import type { EventComponentView } from "@chronelle/schemas";
import { useState } from "react";

import { type DayKey, monthDays, weekDays } from "./day-placement";

/** The period a week or month view shows, and the day chosen in it. */
export interface Period {
  readonly cursor: Date;
  readonly selected: DayKey | null;
  /** Moves the period; the chosen day clears unless one is given. */
  readonly setCursor: (cursor: Date, selected?: DayKey | null) => void;
  readonly setSelected: (selected: DayKey | null) => void;
}

/**
 * Session state for a container's week or month view: the cursor opens on
 * today and returns there whenever the view changes; nothing is saved.
 */
export function usePeriod(view: EventComponentView): Period {
  const [state, setState] = useState(() => ({
    view,
    cursor: new Date(),
    selected: null as DayKey | null,
  }));
  if (state.view !== view)
    setState({ view, cursor: new Date(), selected: null });
  return {
    cursor: state.cursor,
    selected: state.selected,
    setCursor: (cursor, selected = null) =>
      setState({ view, cursor, selected }),
    setSelected: (selected) =>
      setState({ view, cursor: state.cursor, selected }),
  };
}

/** The first and last day a week or month view shows; none for other views. */
export function periodRange(
  view: EventComponentView,
  cursor: Date,
): { readonly from: DayKey; readonly to: DayKey } | null {
  const days =
    view === "week"
      ? weekDays(cursor)
      : view === "month"
        ? monthDays(cursor)
        : [];
  const from = days[0];
  const to = days.at(-1);
  return from === undefined || to === undefined ? null : { from, to };
}
