"use client";

import type { EventComponentView } from "@chronelle/schemas";
import { useState } from "react";

import { type DayKey, monthDays, today, weekDays } from "./day-placement";

/** The period a week or month view shows. */
export interface Period {
  readonly cursor: Date;
  readonly setCursor: (cursor: Date) => void;
}

/**
 * Session state for a container's week or month view: the cursor opens on
 * today and returns there whenever the view changes; nothing is saved.
 */
export function usePeriod(view: EventComponentView): Period {
  const [state, setState] = useState(() => ({ view, cursor: today() }));
  if (state.view !== view) setState({ view, cursor: today() });
  return {
    cursor: state.cursor,
    setCursor: (cursor) => setState({ view, cursor }),
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
