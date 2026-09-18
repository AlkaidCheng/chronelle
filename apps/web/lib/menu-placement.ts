/** The side of its control a list opens on, and a height cap when it fits neither. */
export interface MenuFit {
  readonly side: "below" | "above";
  /** The room on that side when the list is taller than it, so the list scrolls inside. */
  readonly maxHeight: number | null;
}

/** A list stays this clear of the viewport's edges. */
export const menuEdge = 8;

/**
 * The layout viewport in CSS pixels. A phone zooms out when content runs
 * past its width, and `window.innerWidth` grows with it; the root
 * element's client size keeps the width the page was laid out for.
 */
export function viewportSize(): {
  readonly width: number;
  readonly height: number;
} {
  return {
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  };
}

/** What a list keeps clear of at the bottom: the rail on a phone, a hair elsewhere. */
export function reservedBottom(): number {
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 760px)").matches
    ? 96
    : 8;
}

/**
 * Places a list of `height` against its control's box: below when it fits
 * there, above when it only fits there, and otherwise on the roomier side
 * capped to that room, so every entry stays inside the viewport and above
 * the phone's rail.
 */
export function fitMenu(anchor: DOMRect, height: number, gap: number): MenuFit {
  const below = viewportSize().height - reservedBottom() - anchor.bottom - gap;
  const above = anchor.top - gap - menuEdge;
  if (height <= below) return { side: "below", maxHeight: null };
  if (height <= above) return { side: "above", maxHeight: null };
  return above > below
    ? { side: "above", maxHeight: Math.max(above, 0) }
    : { side: "below", maxHeight: Math.max(below, 0) };
}

/** Caps a list to `maxHeight` so it scrolls inside, or lifts the cap. */
export function capMenu(element: HTMLElement, maxHeight: number | null) {
  element.style.maxHeight = maxHeight === null ? "" : `${maxHeight}px`;
  element.style.overflowY = maxHeight === null ? "" : "auto";
}
