"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/** Where a dragged row would land: a group, and its place among the rows there. */
export interface RowDrop {
  readonly groupKey: string;
  /** The index among `rowIds` the row would take. */
  readonly index: number;
  /** The group's rows in visual order, without the dragged one. */
  readonly rowIds: readonly string[];
}

interface DragState {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly drop: RowDrop | null;
}

/** Pixels a pointer travels before a press becomes a drag. */
const dragThreshold = 6;
/** How long a finger rests on a row before the row follows it. */
const longPressMs = 400;

/**
 * Drag any row to another place in its group or into another group. A row
 * registers itself with `rowProps` and a drop target with `groupProps`;
 * the target's rows are read from the document, so a container decides
 * what a group is by where it puts the attribute. A press starts a drag
 * once it travels a few pixels (a long press on touch), so clicks on the
 * row keep their meaning, and the click that ends a drag is swallowed.
 */
export function useRowDrag({
  canDrop,
  enabled,
  labelOf,
  onDrop,
}: {
  /** Whether a row may land in a group; every group accepts by default. */
  readonly canDrop?: ((groupKey: string, id: string) => boolean) | undefined;
  readonly enabled: boolean;
  readonly labelOf: (id: string) => string;
  readonly onDrop: (id: string, drop: RowDrop) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const armed = useRef<{
    id: string;
    element: HTMLElement;
    pointerId: number;
    x: number;
    y: number;
    timer: number | null;
  } | null>(null);
  const settings = useRef({ canDrop, labelOf, onDrop });
  settings.current = { canDrop, labelOf, onDrop };

  const update = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const disarm = useCallback(() => {
    const current = armed.current;
    if (current === null) return;
    if (current.timer !== null) window.clearTimeout(current.timer);
    armed.current = null;
  }, []);

  const locate = useCallback((x: number, y: number): RowDrop | null => {
    const current = dragRef.current;
    if (current === null) return null;
    const under = document.elementFromPoint(x, y);
    const group =
      under instanceof Element
        ? under.closest<HTMLElement>("[data-drop-group]")
        : null;
    if (group === null) return null;
    const groupKey = group.dataset.dropGroup ?? "";
    if (
      settings.current.canDrop !== undefined &&
      !settings.current.canDrop(groupKey, current.id)
    )
      return null;
    const rows = Array.from(
      group.querySelectorAll<HTMLElement>("[data-row-id]"),
    ).filter((row) => row.dataset.rowId !== current.id);
    let index = rows.length;
    for (const [position, row] of rows.entries()) {
      const rect = row.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        index = position;
        break;
      }
    }
    return {
      groupKey,
      index,
      rowIds: rows.map((row) => row.dataset.rowId ?? ""),
    };
  }, []);

  const finish = useCallback(
    (commit: boolean) => {
      const current = dragRef.current;
      if (current === null) return;
      update(null);
      document.body.classList.remove("is-dragging-row");
      if (commit && current.drop !== null)
        settings.current.onDrop(current.id, current.drop);
    },
    [update],
  );

  const begin = useCallback(
    (
      id: string,
      element: HTMLElement,
      pointerId: number,
      x: number,
      y: number,
      at: { readonly x: number; readonly y: number },
    ) => {
      const rect = element.getBoundingClientRect();
      if (typeof element.setPointerCapture === "function") {
        try {
          element.setPointerCapture(pointerId);
        } catch {
          // A pointer that has already left keeps the drag on the document.
        }
      }
      document.body.classList.add("is-dragging-row");
      // The click that ends the drag must not toggle or open anything.
      const swallow = (event: Event) => {
        event.stopPropagation();
        event.preventDefault();
      };
      element.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(
        () => element.removeEventListener("click", swallow, { capture: true }),
        0,
      );
      const follow = (pointer: { readonly x: number; readonly y: number }) => {
        if (dragRef.current === null) return;
        update({
          ...dragRef.current,
          x: rect.left + (pointer.x - x),
          y: rect.top + (pointer.y - y),
          drop: locate(pointer.x, pointer.y),
        });
      };
      update({
        id,
        label: settings.current.labelOf(id),
        x: rect.left,
        y: rect.top,
        width: Math.min(rect.width, 360),
        drop: null,
      });
      follow(at);
      const move = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        follow({ x: event.clientX, y: event.clientY });
      };
      const end = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        cleanup();
        finish(event.type === "pointerup");
      };
      const key = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        cleanup();
        finish(false);
      };
      // Once a finger drags a row, the page must not scroll under it.
      const hold = (event: TouchEvent) => {
        if (dragRef.current !== null) event.preventDefault();
      };
      const cleanup = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", end);
        document.removeEventListener("pointercancel", end);
        document.removeEventListener("keydown", key);
        document.removeEventListener("touchmove", hold);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", end);
      document.addEventListener("pointercancel", end);
      document.addEventListener("keydown", key);
      document.addEventListener("touchmove", hold, { passive: false });
    },
    [finish, locate, update],
  );

  useEffect(() => {
    if (enabled) return;
    disarm();
    finish(false);
  }, [disarm, enabled, finish]);

  const onPointerDown = useCallback(
    (id: string, event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0 || dragRef.current !== null) return;
      if (
        event.target instanceof Element &&
        event.target.closest("input, select, textarea, [contenteditable]")
      )
        return;
      disarm();
      const element = event.currentTarget;
      const { pointerId, clientX: x, clientY: y } = event;
      const touch = event.pointerType === "touch";
      armed.current = {
        id,
        element,
        pointerId,
        x,
        y,
        timer: touch
          ? window.setTimeout(() => {
              if (armed.current?.pointerId !== pointerId) return;
              armed.current = null;
              begin(id, element, pointerId, x, y, { x, y });
            }, longPressMs)
          : null,
      };
      const move = (moved: PointerEvent) => {
        const current = armed.current;
        if (current === null || moved.pointerId !== pointerId) {
          stop();
          return;
        }
        if (Math.hypot(moved.clientX - x, moved.clientY - y) < dragThreshold)
          return;
        stop();
        disarm();
        // A finger that moves before the long press is scrolling.
        if (!touch)
          begin(id, element, pointerId, x, y, {
            x: moved.clientX,
            y: moved.clientY,
          });
      };
      const stop = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", release);
        document.removeEventListener("pointercancel", release);
      };
      const release = () => {
        stop();
        disarm();
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", release);
      document.addEventListener("pointercancel", release);
    },
    [begin, disarm, enabled],
  );

  const rowProps = useCallback(
    (id: string) => ({
      "data-row-id": id,
      onPointerDown: enabled
        ? (event: ReactPointerEvent<HTMLElement>) => onPointerDown(id, event)
        : undefined,
    }),
    [enabled, onPointerDown],
  );

  const groupProps = useCallback(
    (groupKey: string) => (enabled ? { "data-drop-group": groupKey } : {}),
    [enabled],
  );

  /** The class a row takes while a drop is proposed around it. */
  const rowClass = useCallback(
    (groupKey: string, id: string): string | undefined => {
      if (drag === null) return undefined;
      if (drag.id === id) return "is-dragging";
      const { drop } = drag;
      if (drop === null || drop.groupKey !== groupKey) return undefined;
      if (drop.rowIds[drop.index] === id) return "is-drop-before";
      if (drop.index === drop.rowIds.length && drop.rowIds.at(-1) === id)
        return "is-drop-after";
      return undefined;
    },
    [drag],
  );

  return { drag, groupProps, rowClass, rowProps };
}
