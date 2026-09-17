"use client";

import type { RailPreference } from "@chronelle/schemas";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useId,
  useRef,
  useState,
} from "react";

import {
  arrangeRail,
  moveKey,
  placeKey,
  type RailArrangement,
  railPreferenceOf,
} from "../lib/rail-preference";
import { useSessionQuery, useUpdatePreferences } from "../lib/queries";
import { EyeIcon, EyeOffIcon, GripIcon, PencilIcon } from "./icons";
import { railCollectionKeys, railCollections } from "./workspace-navigation";

/**
 * The Collections section of the rail: the workspace collections in the
 * account's order, without the hidden ones (a hidden collection still shows
 * while it is the open page). Customize mode adds a grip to each row (drag,
 * or the arrow keys on the grip, reorder) and an eye that hides or shows
 * it; every change is kept on the account at once, the rows showing the
 * choice until the account has answered. A row's link does not navigate
 * while customizing, so a press that starts a drag stays on the page.
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
      >
        {rows.map((collection) => {
          const name = t(collection.key);
          const hidden = arranged.hidden.has(collection.key);
          const current = isCurrent(collection.href);
          return (
            <li
              key={collection.key}
              className="rail-row"
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
            >
              {customizing ? (
                <button
                  type="button"
                  className="rail-grip"
                  aria-label={t("move", { name })}
                  onKeyDown={(event) => onGripKeyDown(event, collection.key)}
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
