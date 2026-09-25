"use client";

import type { EventListQuery } from "@livtales/schemas";
import {
  createContext,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

interface Criteria {
  readonly query: string;
  readonly scope: EventListQuery["scope"];
  readonly filter: EventListQuery["filter"];
  readonly sort: EventListQuery["sort"];
}

interface ReturnPoint {
  readonly id: string;
  readonly top: number;
  readonly scrollY: number;
}

interface CollectionState {
  readonly criteria: Criteria;
  readonly change: (patch: Partial<Criteria>) => void;
  readonly layout: "grid" | "list";
  readonly changeLayout: (layout: "grid" | "list") => void;
  readonly returnPoint: RefObject<ReturnPoint | null>;
}

const CollectionContext = createContext<CollectionState | null>(null);

/** Retains navigation preferences only for the current authenticated session. */
export function EventCollectionProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [criteria, setCriteria] = useState<Criteria>({
    query: "",
    scope: "all",
    filter: "all",
    sort: "date",
  });
  const returnPoint = useRef<ReturnPoint | null>(null);
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  useEffect(() => {
    try {
      if (window.localStorage.getItem("chronelle.event-layout") === "list")
        setLayout("list");
    } catch {
      // Layout remains usable when browser storage is unavailable.
    }
  }, []);
  return (
    <CollectionContext.Provider
      value={{
        criteria,
        returnPoint,
        layout,
        changeLayout: (value) => {
          returnPoint.current = null;
          setLayout(value);
          try {
            window.localStorage.setItem("chronelle.event-layout", value);
          } catch {
            // Persistence is optional; no event data is stored here.
          }
        },
        change: (patch) => {
          returnPoint.current = null;
          setCriteria((previous) => ({ ...previous, ...patch }));
        },
      }}
    >
      {children}
    </CollectionContext.Provider>
  );
}

export function useEventCollectionState() {
  const value = useContext(CollectionContext);
  if (!value) throw new Error("EventCollectionProvider is required.");
  return value;
}

/** Returns to an opened card after the collection has finished loading. */
export function useEventCollectionReturn(ready: boolean) {
  const { returnPoint } = useEventCollectionState();
  const [point] = useState(() => returnPoint.current);
  const container = useRef<HTMLElement | null>(null);
  const restored = useRef(false);

  useEffect(() => {
    if (!point) return;
    const cancel = () => {
      if (!restored.current) returnPoint.current = null;
    };
    const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const event of events)
      window.addEventListener(event, cancel, { passive: true });
    return () => {
      for (const event of events) window.removeEventListener(event, cancel);
    };
  }, [point, returnPoint]);

  useEffect(() => {
    if (!ready || !point || restored.current || returnPoint.current !== point)
      return;
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        if (returnPoint.current !== point) return;
        restored.current = true;
        const card = Array.from(
          container.current?.querySelectorAll<HTMLAnchorElement>(
            "[data-event-id]",
          ) ?? [],
        ).find((element) => element.dataset.eventId === point.id);
        const top = card
          ? window.scrollY + card.getBoundingClientRect().top - point.top
          : point.scrollY;
        (card ?? container.current)?.focus({ preventScroll: true });
        window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ready, point, returnPoint]);

  function remember(id: string, event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    returnPoint.current = {
      id,
      top: event.currentTarget.getBoundingClientRect().top,
      scrollY: window.scrollY,
    };
  }

  return { container, remember };
}
