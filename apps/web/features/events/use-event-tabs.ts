"use client";

import type { EventTabsPreference } from "@chronelle/schemas";
import { useRef, useState } from "react";
import {
  arrangeEventTabs,
  eventTabsPreferenceOf,
  fixedViews,
  stripViews,
  type TabArrangement,
} from "../../lib/event-tabs";
import type { EventView } from "../../lib/event-views";
import { moveKey, placeKey } from "../../lib/key-order";
import { useSessionQuery, useUpdatePreferences } from "../../lib/queries";

/** An event's tabs for the account, and the changes the strip and Manage tabs make to them. */
export interface EventTabsState {
  /** The views the account may put on this event. */
  readonly known: readonly EventView[];
  readonly arranged: TabArrangement;
  readonly toggleHidden: (key: string) => void;
  /** Puts a view back on the event, at the end of the strip. */
  readonly add: (view: EventView) => void;
  /** Takes a view off the event; a fixed view stays. */
  readonly remove: (view: EventView) => void;
  readonly moveView: (view: EventView, delta: number) => void;
  readonly placeView: (view: EventView, before: EventView | null) => void;
}

/**
 * The account's tabs for one event: the arrangement applied to the views
 * the account may see, kept on the account through the preferences
 * request. A change shows at once and is sent as it is made; the reply
 * or the refusal settles the session, so the strip never waits.
 */
export function useEventTabs(
  eventId: string,
  pageIds: readonly string[],
  canShare: boolean,
): EventTabsState {
  const session = useSessionQuery();
  const update = useUpdatePreferences();
  const [pending, setPending] = useState<EventTabsPreference | null>(null);
  const inFlight = useRef(0);
  const known = canShare
    ? stripViews
    : stripViews.filter((view) => view !== "sharing");
  const stored = pending ?? session.data?.user.eventTabs[eventId] ?? {};
  const arranged = arrangeEventTabs(stored, known);

  function keep(next: TabArrangement) {
    const tabs = eventTabsPreferenceOf(next, stored, known, pageIds);
    setPending(tabs);
    inFlight.current += 1;
    update.mutate(
      { eventTabs: { [eventId]: tabs } },
      {
        onSettled: () => {
          inFlight.current -= 1;
          if (inFlight.current === 0) setPending(null);
        },
      },
    );
  }

  return {
    known,
    arranged,
    toggleHidden: (key) => {
      const hidden = new Set(arranged.hidden);
      if (hidden.has(key)) hidden.delete(key);
      else hidden.add(key);
      keep({ ...arranged, hidden });
    },
    add: (view) => {
      if (!arranged.removed.has(view)) return;
      const removed = new Set(arranged.removed);
      removed.delete(view);
      keep({ ...arranged, order: [...arranged.order, view], removed });
    },
    remove: (view) => {
      if (fixedViews.has(view) || arranged.removed.has(view)) return;
      const hidden = new Set(arranged.hidden);
      hidden.delete(view);
      keep({
        order: arranged.order.filter((candidate) => candidate !== view),
        hidden,
        removed: new Set([...arranged.removed, view]),
      });
    },
    moveView: (view, delta) => {
      const order = moveKey(
        arranged.order,
        view,
        delta,
      ) as readonly EventView[];
      if (order !== arranged.order) keep({ ...arranged, order });
    },
    placeView: (view, before) => {
      const order = placeKey(
        arranged.order,
        view,
        before,
      ) as readonly EventView[];
      if (order !== arranged.order) keep({ ...arranged, order });
    },
  };
}
