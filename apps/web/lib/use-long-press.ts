import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
} from "react";

/** How long a touch stays put before it counts as a long press. */
export const longPressDelayMs = 500;
/** How far the touch may drift meanwhile before it is a scroll instead. */
export const longPressTolerancePx = 8;

/**
 * A long press with a touch, as handlers to spread on a container. A touch
 * that lands on an element `select` picks out and stays put for the delay
 * fires `onLongPress` with that element; the click and the context menu
 * the browser sends afterwards are swallowed. A lift before the delay is
 * the ordinary tap, a move beyond the tolerance (a scroll) cancels the
 * press, and mouse and pen pointers pass through untouched: only the
 * pressing pointer's own events count, so a mouse pointer leaving the
 * container while a finger holds (a touch beside a trackpad, or a
 * browser reporting the last mouse position) does not end the press.
 */
export function useLongPress<T extends HTMLElement>(
  select: (target: Element) => T | null,
  onLongPress: (element: T) => void,
) {
  const press = useRef<{
    pointerId: number;
    x: number;
    y: number;
    timer: number;
  } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    if (press.current === null) return;
    window.clearTimeout(press.current.timer);
    press.current = null;
  };
  // The mouse pointer may carry the same id as a finger (browsers number
  // them independently), so the pointer type is checked as well.
  const cancelOwn = (event: ReactPointerEvent<HTMLElement>) => {
    if (
      event.pointerType === "touch" &&
      press.current?.pointerId === event.pointerId
    )
      cancel();
  };
  // A press still counting when the container unmounts never fires.
  useEffect(
    () => () => {
      if (press.current !== null) window.clearTimeout(press.current.timer);
    },
    [],
  );
  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      cancel();
      fired.current = false;
      if (event.pointerType !== "touch" || !event.isPrimary) return;
      const element = select(event.target as Element);
      if (element === null) return;
      const timer = window.setTimeout(() => {
        press.current = null;
        fired.current = true;
        onLongPress(element);
      }, longPressDelayMs);
      press.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        timer,
      };
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      const current = press.current;
      if (
        current === null ||
        event.pointerType !== "touch" ||
        current.pointerId !== event.pointerId
      )
        return;
      if (
        Math.hypot(event.clientX - current.x, event.clientY - current.y) >
        longPressTolerancePx
      )
        cancel();
    },
    onPointerUp: cancelOwn,
    onPointerCancel: cancelOwn,
    onPointerLeave: cancelOwn,
    onClickCapture(event: ReactMouseEvent<HTMLElement>) {
      if (!fired.current) return;
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onContextMenu(event: ReactMouseEvent<HTMLElement>) {
      if (press.current !== null || fired.current) event.preventDefault();
    },
  };
}
