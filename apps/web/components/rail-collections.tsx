"use client";

import type { RailPreference } from "@chronelle/schemas";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useId,
  useRef,
  useState,
} from "react";

import { moveKey, placeKey } from "../lib/key-order";
import {
  arrangeRail,
  type RailArrangement,
  railPreferenceOf,
} from "../lib/rail-preference";
import { useSessionQuery, useUpdatePreferences } from "../lib/queries";
import { EyeIcon, EyeOffIcon, GripIcon, PencilIcon } from "./icons";
import { railCollectionKeys, railCollections } from "./workspace-navigation";

/**
 * The Collections section of the rail: the workspace collections in the
 * account's order, without the hidden ones (a hidden collection still shows
 * while it is the open page). Customize mode adds a grip to each row (drag
 * the row with a mouse, drag the grip with a finger, or the arrow keys on
 * the grip, reorder) and an eye that hides or shows it; every change is
 * kept on the account at once, the rows showing the choice until the
 * account has answered. A row's link does not navigate while customizing,
 * so a press that starts a drag stays on the page.
 */
export function RailCollections({
  pathname,
  customizing,
  onCustomize,
}: {
  readonly pathname: string;
  readonly customizing: boolean;
  readonly onCustomize: (customizing: boolean) => void;
}) {
  const t = useTranslations("nav");
  const id = useId();
  const session = useSessionQuery();
  const update = useUpdatePreferences();
  const [pending, setPending] = useState<RailPreference | null>(null);
  const inFlight = useRef(0);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null | undefined>();
  const list = useRef<HTMLUListElement>(null);
  // A finger's drag: the row it lifted and how far, and the place it would
  // drop, kept outside the render for the document listeners.
  const [lift, setLift] = useState<{ key: string; dy: number } | null>(null);
  const touchDrop = useRef<string | null | undefined>(undefined);

  const stored = pending ?? session.data?.user.rail ?? {};
  const arranged = arrangeRail(stored, railCollectionKeys);
  const isCurrent = (href: string) => pathname.startsWith(href);
  const rows = arranged.order
    .map((key) => railCollections.find((collection) => collection.key === key))
    .filter((collection) => collection !== undefined)
    .filter(
      (collection) =>
        customizing ||
        !arranged.hidden.has(collection.key) ||
        isCurrent(collection.href),
    );

  function keep(next: RailArrangement) {
    const rail = railPreferenceOf(next, stored, railCollectionKeys);
    setPending(rail);
    inFlight.current += 1;
    update.mutate(
      { rail },
      {
        onSettled: () => {
          inFlight.current -= 1;
          if (inFlight.current === 0) setPending(null);
        },
      },
    );
  }
  function toggleHidden(key: string) {
    const hidden = new Set(arranged.hidden);
    if (hidden.has(key)) hidden.delete(key);
    else hidden.add(key);
    keep({ order: arranged.order, hidden });
  }
  function onGripKeyDown(event: ReactKeyboardEvent<HTMLElement>, key: string) {
    const delta =
      event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const order = moveKey(arranged.order, key, delta);
    if (order !== arranged.order) keep({ order, hidden: arranged.hidden });
  }
  function onDragOver(event: DragEvent<HTMLElement>, key: string) {
    if (dragging === null || dragging === key) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const before = event.clientY < bounds.top + bounds.height / 2;
    const order = arranged.order;
    const target = before ? key : (order[order.indexOf(key) + 1] ?? null);
    setDropBefore(target);
  }
  function onDrop() {
    if (dragging !== null && dropBefore !== undefined) {
      const order = placeKey(arranged.order, dragging, dropBefore);
      if (order !== arranged.order) keep({ order, hidden: arranged.hidden });
    }
    setDragging(null);
    setDropBefore(undefined);
  }

  /** The row a point would drop before, among the rows other than `key`; null past the last. */
  function dropTargetAt(y: number, key: string): string | null {
    const rows = Array.from(
      list.current?.querySelectorAll<HTMLElement>("li[data-key]") ?? [],
    );
    for (const row of rows) {
      if (row.dataset.key === key) continue;
      const bounds = row.getBoundingClientRect();
      if (y < bounds.top + bounds.height / 2) return row.dataset.key ?? null;
    }
    return null;
  }

  /**
   * A finger on the grip lifts the row at once (the grip is a handle, so
   * no long press stands between the touch and the drag) and the row
   * follows it; the finger lifting drops it, a cancel or Escape puts it
   * back. The mouse keeps the row's own drag.
   */
  function onGripPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    key: string,
  ) {
    if (event.pointerType !== "touch" || !customizing || lift !== null) return;
    event.preventDefault();
    const grip = event.currentTarget;
    const { pointerId, clientY: startY } = event;
    if (typeof grip.setPointerCapture === "function") {
      try {
        grip.setPointerCapture(pointerId);
      } catch {
        // A pointer that has already left keeps the drag on the document.
      }
    }
    touchDrop.current = undefined;
    setDragging(key);
    setDropBefore(undefined);
    setLift({ key, dy: 0 });
    const move = (moved: PointerEvent) => {
      if (moved.pointerId !== pointerId) return;
      const drop = dropTargetAt(moved.clientY, key);
      touchDrop.current = drop;
      setLift({ key, dy: moved.clientY - startY });
      setDropBefore(drop);
    };
    const settle = (commit: boolean) => {
      cleanup();
      const drop = touchDrop.current;
      if (commit && drop !== undefined) {
        const order = placeKey(arranged.order, key, drop);
        if (order !== arranged.order) keep({ order, hidden: arranged.hidden });
      }
      touchDrop.current = undefined;
      setLift(null);
      setDragging(null);
      setDropBefore(undefined);
    };
    const end = (ended: PointerEvent) => {
      if (ended.pointerId !== pointerId) return;
      settle(ended.type === "pointerup");
    };
    const cancelKey = (pressed: KeyboardEvent) => {
      if (pressed.key === "Escape") settle(false);
    };
    // The page must not scroll under the lifted row.
    const hold = (touch: TouchEvent) => touch.preventDefault();
    const cleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      document.removeEventListener("keydown", cancelKey);
      document.removeEventListener("touchmove", hold);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    document.addEventListener("keydown", cancelKey);
    document.addEventListener("touchmove", hold, { passive: false });
  }

  return (
    <>
      <div className="rail-heading">
        <span id={`${id}-heading`}>{t("collections")}</span>
        <button
          type="button"
          className="rail-customize"
          aria-label={t("customize")}
          aria-pressed={customizing}
          onClick={() => onCustomize(!customizing)}
        >
          <PencilIcon />
        </button>
      </div>
      <ul
        className="rail-collections"
        data-customizing={customizing || undefined}
        aria-labelledby={`${id}-heading`}
        ref={list}
      >
        {rows.map((collection) => {
          const name = t(collection.key);
          const hidden = arranged.hidden.has(collection.key);
          const current = isCurrent(collection.href);
          return (
            <li
              key={collection.key}
              className="rail-row"
              data-key={collection.key}
              data-hidden={hidden || undefined}
              data-drop={
                dragging !== null && dropBefore === collection.key
                  ? "before"
                  : dragging !== null &&
                      dropBefore === null &&
                      collection.key === arranged.order.at(-1)
                    ? "after"
                    : undefined
              }
              data-dragging={dragging === collection.key || undefined}
              data-lifted={lift?.key === collection.key || undefined}
              style={
                lift?.key === collection.key
                  ? { transform: `translateY(${lift.dy}px)` }
                  : undefined
              }
            >
              {customizing ? (
                <button
                  type="button"
                  className="rail-grip"
                  aria-label={t("move", { name })}
                  onKeyDown={(event) => onGripKeyDown(event, collection.key)}
                  onPointerDown={(event) =>
                    onGripPointerDown(event, collection.key)
                  }
                >
                  <GripIcon />
                </button>
              ) : null}
              <Link
                href={collection.href}
                aria-current={current ? "page" : undefined}
                className={current ? "active" : ""}
                draggable={customizing || undefined}
                onDragStart={(event) => {
                  if (!customizing) return;
                  event.dataTransfer.effectAllowed = "move";
                  setDragging(collection.key);
                }}
                onDragOver={(event) => onDragOver(event, collection.key)}
                onDrop={(event) => {
                  event.preventDefault();
                  onDrop();
                }}
                onDragEnd={onDrop}
                onClick={(event) => {
                  if (customizing) event.preventDefault();
                }}
              >
                <collection.icon />
                {name}
              </Link>
              {customizing ? (
                <button
                  type="button"
                  className="rail-eye"
                  aria-label={
                    hidden ? t("show", { name }) : t("hide", { name })
                  }
                  aria-pressed={hidden}
                  onClick={() => toggleHidden(collection.key)}
                >
                  {hidden ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {customizing ? (
        <p className="rail-customize-bar">
          {t("customizeHint")}{" "}
          <button type="button" onClick={() => onCustomize(false)}>
            {t("done")}
          </button>
        </p>
      ) : null}
    </>
  );
}
