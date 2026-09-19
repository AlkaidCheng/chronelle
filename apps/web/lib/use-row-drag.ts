"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
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

export interface DragState {
  readonly id: string;
  readonly label: string;
  /** Lifted from the keyboard: the row stays in place, dimmed, while the gap moves. */
  readonly keyboard: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  /** The lifted row's height, which the gap takes. */
  readonly height: number;
  readonly drop: RowDrop | null;
  /** Where a keyboard lift started; the gap hides while the drop is still there. */
  readonly origin: RowDrop | null;
}

/** Pixels a pointer travels before a press on a row becomes a drag. */
const dragThreshold = 6;
/** How long a finger rests on a row before the row follows it. */
const longPressMs = 400;

type DragRoot = ParentNode & { querySelectorAll: Document["querySelectorAll"] };

/**
 * Drag any row to another place in its group or into another group. A row
 * registers itself with `rowProps` and its grip with `gripProps`; a drop
 * target with `groupProps`, and the container the drag stays within with
 * `rootProps`. The rows are read from the document, so a container decides
 * what a group is by where it puts the attribute. A press on the row
 * starts a drag once it travels a few pixels (a long press on touch), so
 * clicks on the row keep their meaning; a press on the grip lifts the row
 * at once. The lifted row leaves the flow as a card that follows the
 * pointer, and a gap of its height marks where it will land, following
 * the pointer's height alone: the nearest row, before or after its middle,
 * or an empty group under the pointer. Letting go fills the gap. From the
 * keyboard, the grip's arrow keys move the gap a place and Enter drops.
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
  const rootRef = useRef<DragRoot | null>(null);
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

  /** The groups the row may land in, each with its rows other than the row. */
  const places = useCallback((id: string) => {
    const groups = Array.from(
      (rootRef.current ?? document).querySelectorAll<HTMLElement>(
        "[data-drop-group]",
      ),
    ).filter(
      (group) =>
        settings.current.canDrop === undefined ||
        settings.current.canDrop(group.dataset.dropGroup ?? "", id),
    );
    return groups.map((group) => ({
      group,
      groupKey: group.dataset.dropGroup ?? "",
      rows: Array.from(
        group.querySelectorAll<HTMLElement>("[data-row-id]"),
      ).filter(
        (row) =>
          row.dataset.rowId !== id &&
          row.parentElement?.closest("[data-drop-group]") === group,
      ),
    }));
  }, []);

  /** The gap's place for a pointer height: an empty group under it, else the nearest row. */
  const locate = useCallback(
    (y: number): RowDrop | null => {
      const current = dragRef.current;
      if (current === null) return null;
      const candidates = places(current.id);
      for (const { group, groupKey, rows } of candidates) {
        if (rows.length > 0) continue;
        const zone = group.closest<HTMLElement>("[data-drop-zone]") ?? group;
        const rect = zone.getBoundingClientRect();
        if (rect.height > 0 && y >= rect.top && y <= rect.bottom)
          return { groupKey, index: 0, rowIds: [] };
      }
      let nearest: {
        readonly groupKey: string;
        readonly rows: readonly HTMLElement[];
        readonly at: number;
        readonly rect: DOMRect;
      } | null = null;
      let distance = Number.POSITIVE_INFINITY;
      for (const { groupKey, rows } of candidates) {
        for (const [at, row] of rows.entries()) {
          const rect = row.getBoundingClientRect();
          if (rect.height === 0) continue;
          const gap =
            y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
          if (gap < distance) {
            distance = gap;
            nearest = { groupKey, rows, at, rect };
          }
        }
      }
      if (nearest === null) return null;
      const before = y < nearest.rect.top + nearest.rect.height / 2;
      return {
        groupKey: nearest.groupKey,
        index: before ? nearest.at : nearest.at + 1,
        rowIds: nearest.rows.map((row) => row.dataset.rowId ?? ""),
      };
    },
    [places],
  );

  /** The row's own place: its group and its index among the other rows there. */
  const placeOf = useCallback(
    (id: string, element: HTMLElement): RowDrop | null => {
      const group =
        element.parentElement?.closest<HTMLElement>("[data-drop-group]") ??
        null;
      if (group === null) return null;
      const found = places(id).find((place) => place.group === group);
      if (found === undefined) return null;
      const siblings = Array.from(
        group.querySelectorAll<HTMLElement>("[data-row-id]"),
      ).filter(
        (row) => row.parentElement?.closest("[data-drop-group]") === group,
      );
      const at = siblings.findIndex((row) => row.dataset.rowId === id);
      return {
        groupKey: found.groupKey,
        index: at < 0 ? found.rows.length : at,
        rowIds: found.rows.map((row) => row.dataset.rowId ?? ""),
      };
    },
    [places],
  );

  const finish = useCallback(
    (commit: boolean) => {
      const current = dragRef.current;
      if (current === null) return;
      update(null);
      document.body.classList.remove("is-dragging-row");
      if (
        commit &&
        current.drop !== null &&
        !samePlace(current.drop, current.origin)
      )
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
      const row = element.closest<HTMLElement>("[data-row-id]") ?? element;
      rootRef.current =
        row.closest<HTMLElement>("[data-drag-root]") ?? document;
      const rect = row.getBoundingClientRect();
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
          drop: locate(pointer.y),
        });
      };
      update({
        id,
        label: settings.current.labelOf(id),
        keyboard: false,
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        drop: null,
        origin: null,
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
        event.target.closest(
          "input, select, textarea, [contenteditable], .row-grip",
        )
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

  /** A press on the grip lifts the row at once. */
  const onGripPointerDown = useCallback(
    (id: string, event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0 || dragRef.current !== null) return;
      event.preventDefault();
      disarm();
      const { pointerId, clientX: x, clientY: y } = event;
      begin(id, event.currentTarget, pointerId, x, y, { x, y });
    },
    [begin, disarm, enabled],
  );

  /** Lifts from the keyboard at the row's own place. */
  const lift = useCallback(
    (id: string, element: HTMLElement): DragState | null => {
      const row = element.closest<HTMLElement>("[data-row-id]") ?? element;
      rootRef.current =
        row.closest<HTMLElement>("[data-drag-root]") ?? document;
      const rect = row.getBoundingClientRect();
      const state: DragState = {
        id,
        label: settings.current.labelOf(id),
        keyboard: true,
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        drop: null,
        origin: null,
      };
      dragRef.current = state;
      const drop = placeOf(id, row);
      const lifted = { ...state, drop, origin: drop };
      update(lifted);
      return lifted;
    },
    [placeOf, update],
  );

  const onGripKeyDown = useCallback(
    (id: string, event: ReactKeyboardEvent<HTMLElement>) => {
      if (!enabled) return;
      const current = dragRef.current;
      const lifted = current !== null && current.id === id && current.keyboard;
      if (event.key === "Escape") {
        if (!lifted) return;
        event.preventDefault();
        event.stopPropagation();
        finish(false);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (lifted) finish(true);
        else lift(id, event.currentTarget);
        return;
      }
      const step =
        event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      if (step === 0) return;
      event.preventDefault();
      const state = lifted ? current : lift(id, event.currentTarget);
      if (state === null || state.drop === null) return;
      // The places the gap can take, each group's slots in order.
      const slots = places(id).flatMap(({ groupKey, rows }) => {
        const rowIds = rows.map((row) => row.dataset.rowId ?? "");
        return Array.from({ length: rows.length + 1 }, (_, index) => ({
          groupKey,
          index,
          rowIds,
        }));
      });
      const at = slots.findIndex(
        (slot) =>
          slot.groupKey === state.drop?.groupKey &&
          slot.index === state.drop.index,
      );
      const next = slots[at + step];
      if (next === undefined) return;
      update({ ...state, drop: next });
    },
    [enabled, finish, lift, places, update],
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

  const gripProps = useCallback(
    (id: string) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) =>
        onGripPointerDown(id, event),
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) =>
        onGripKeyDown(id, event),
      onBlur: () => {
        const current = dragRef.current;
        if (current !== null && current.id === id && current.keyboard)
          finish(false);
      },
      "aria-pressed":
        drag !== null && drag.id === id && drag.keyboard ? true : undefined,
    }),
    [drag, finish, onGripKeyDown, onGripPointerDown],
  );

  const groupProps = useCallback(
    (groupKey: string) => (enabled ? { "data-drop-group": groupKey } : {}),
    [enabled],
  );

  const rootProps = useCallback(
    () => (enabled ? { "data-drag-root": "" } : {}),
    [enabled],
  );

  /** The class a row takes while lifted: out of the flow by pointer, dimmed by keyboard. */
  const rowClass = useCallback(
    (_groupKey: string, id: string): string | undefined => {
      if (drag === null || drag.id !== id) return undefined;
      return drag.keyboard ? "is-lifted" : "is-dragging";
    },
    [drag],
  );

  /** The gap's height when it sits at this place, else null. */
  const gapAt = useCallback(
    (groupKey: string, index: number): number | null => {
      if (drag === null || drag.drop === null) return null;
      if (samePlace(drag.drop, drag.origin)) return null;
      return drag.drop.groupKey === groupKey && drag.drop.index === index
        ? drag.height
        : null;
    },
    [drag],
  );

  return { drag, gapAt, gripProps, groupProps, rootProps, rowClass, rowProps };
}

function samePlace(a: RowDrop | null, b: RowDrop | null): boolean {
  return (
    a !== null && b !== null && a.groupKey === b.groupKey && a.index === b.index
  );
}

/**
 * A group's rows with the gap among them: the gap sits before the row at
 * the drop index, counting the rows other than the lifted one, or after
 * the last. The lifted row keeps its place; its class hides or dims it.
 */
export function rowsWithGap<Row extends { readonly id: string }>(
  groupKey: string,
  rows: readonly Row[],
  drag: Pick<DragState, "id"> | null,
  gapAt: (groupKey: string, index: number) => number | null,
  render: (row: Row) => ReactNode,
  gap: (height: number, key: string) => ReactNode,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let index = 0;
  for (const row of rows) {
    if (drag !== null && row.id === drag.id) {
      nodes.push(render(row));
      continue;
    }
    const height = gapAt(groupKey, index);
    if (height !== null) nodes.push(gap(height, `gap:${groupKey}:${index}`));
    nodes.push(render(row));
    index += 1;
  }
  const height = gapAt(groupKey, index);
  if (height !== null) nodes.push(gap(height, `gap:${groupKey}:${index}`));
  return nodes;
}
