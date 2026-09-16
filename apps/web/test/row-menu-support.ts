import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

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
