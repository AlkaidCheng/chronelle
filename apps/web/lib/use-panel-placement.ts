"use client";

import { type RefObject, useLayoutEffect } from "react";

/**
 * Keeps a panel against the viewport by the control that opened it (its
 * parent element): under it, above it when only that side holds the whole
 * panel, and over it when neither does (a short window), so the panel's
 * body always shows. The panel is fixed rather than absolute because the
 * editors' bodies and the lists' tables scroll and would clip a child that
 * ran past them; on a phone the stylesheet makes it a sheet and the
 * position is left alone.
 */
export function usePanelPlacement(panel: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const element = panel.current;
    const opener = element?.parentElement;
    if (!element || !opener) return;
    const place = () => {
      if (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(max-width: 600px)").matches
      ) {
        element.style.left = "";
        element.style.top = "";
        element.style.maxHeight = "";
        return;
      }
      const gap = 4;
      const edge = 12;
      const anchor = opener.getBoundingClientRect();
      // The height the panel asks for, free of an earlier cap.
      element.style.maxHeight = "";
      const height = element.offsetHeight;
      const below = window.innerHeight - anchor.bottom - gap - edge;
      const above = anchor.top - gap - edge;
      let top = anchor.bottom + gap;
      let room = below;
      if (height > below && height <= above) {
        top = anchor.top - gap - height;
        room = above;
      } else if (height > below) {
        room = Math.min(height, window.innerHeight - 2 * edge);
        top = Math.min(top, window.innerHeight - edge - room);
      }
      element.style.maxHeight = `${Math.max(160, room)}px`;
      const left = Math.min(
        Math.max(edge, anchor.left),
        window.innerWidth - element.offsetWidth - edge,
      );
      element.style.top = `${Math.max(edge, top)}px`;
      element.style.left = `${left}px`;
    };
    // The months scrolling inside the panel move nothing outside it.
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && element.contains(event.target))
        return;
      place();
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [panel]);
}
