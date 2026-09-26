import type { MouseEvent } from "react";

/**
 * Whether a click on a link is the page's to handle: the main button with no
 * modifier. A modified or middle click stays with the browser, which opens
 * the link's address in a new tab or window.
 */
export function isPlainClick(event: MouseEvent<HTMLElement>): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
