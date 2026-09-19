import { fireEvent, screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { vi } from "vitest";

/** Opens a row's menu and chooses one of its entries. */
export async function chooseRowAction(
  user: UserEvent,
  row: HTMLElement,
  label: string,
): Promise<void> {
  await user.click(within(row).getByRole("button", { name: /^Actions for / }));
  await user.click(await screen.findByRole("menuitem", { name: label }));
}

/**
 * Gives jsdom pointer events that carry a pointer id and type, so a drag
 * can be driven with fireEvent. Returns the restore function.
 */
export function installPointerEvents(): () => void {
  const previous = (window as { PointerEvent?: unknown }).PointerEvent;
  class FakePointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(
      type: string,
      init: MouseEventInit & { pointerId?: number; pointerType?: string } = {},
    ) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  (window as { PointerEvent?: unknown }).PointerEvent = FakePointerEvent;
  return () => {
    (window as { PointerEvent?: unknown }).PointerEvent = previous;
  };
}

/**
 * Gives jsdom a layout for a drag: every row is 40px tall in document
 * order, a group or zone spans its rows, and an empty one sits below every
 * row. Returns the spy so a test can restore it.
 */
export function installRowLayout(rowHeight = 40) {
  return vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element) {
      const rows = Array.from(document.querySelectorAll("[data-row-id]"));
      const box = (top: number, bottom: number) =>
        ({
          top,
          bottom,
          height: bottom - top,
          left: 0,
          right: 600,
          width: 600,
        }) as DOMRect;
      const row = this.closest("[data-row-id]");
      const at = rows.indexOf(row ?? this);
      if (at >= 0) return box(at * rowHeight, (at + 1) * rowHeight);
      const own = rows.filter((candidate) => this.contains(candidate));
      const first = own[0];
      const last = own.at(-1);
      if (first !== undefined && last !== undefined)
        return box(
          rows.indexOf(first) * rowHeight,
          (rows.indexOf(last) + 1) * rowHeight,
        );
      return box(rows.length * rowHeight, (rows.length + 1) * rowHeight);
    });
}

/** Fires one pointer event with the id and type a drag reads. */
export function firePointer(
  type: "pointerDown" | "pointerMove" | "pointerUp",
  element: Element | Document,
  x: number,
  y: number,
  pointerId = 1,
): void {
  fireEvent[type](element, {
    button: 0,
    clientX: x,
    clientY: y,
    pointerId,
    pointerType: "mouse",
  });
}
