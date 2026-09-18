"use client";

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { capMenu, fitMenu } from "../lib/menu-placement";
import { MoreIcon } from "./icons";
import { useMenuDismissal } from "./quiet-menu";

export type RowMenuEntry =
  | {
      readonly kind: "action";
      readonly label: string;
      readonly onSelect: () => void;
      readonly danger?: boolean;
      readonly disabled?: boolean;
    }
  | {
      /** A choice list that opens in place of the menu, one choice at a time. */
      readonly kind: "choices";
      readonly label: string;
      /** A line above the choices, such as the current value. */
      readonly note?: string | undefined;
      readonly choices: readonly {
        readonly label: string;
        readonly checked: boolean;
        readonly onSelect: () => void;
      }[];
    }
  | { readonly kind: "rule" };

const gap = 4;

/**
 * A row's further options behind one button: the menu opens on request,
 * arrow keys move through it, Escape or a press outside closes it and
 * focus returns to the button. A choice entry swaps its choices into the
 * same narrow list; Escape or Arrow Left brings the entries back. An
 * entry runs after the menu has closed, so a dialog it opens returns
 * focus to the button when it closes.
 */
export function RowMenu({
  entries,
  label,
}: {
  readonly entries: readonly RowMenuEntry[];
  readonly label: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<number | null>(null);
  const [place, setPlace] = useState<{
    readonly top: number;
    readonly right: number;
  } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setView(null);
    setPlace(null);
    if (refocus) button.current?.focus();
  }, []);

  const run = useCallback(
    (action: () => void) => {
      close(true);
      action();
    },
    [close],
  );

  // The menu sits at the button's corner, above it when the viewport
  // below is short, and scrolls inside when it fits neither way; its
  // height changes with the list shown, so the place is measured again
  // when the choices swap in or out.
  const shown = open ? (view ?? -1) : null;
  useLayoutEffect(() => {
    if (shown === null) return;
    const anchor = button.current?.getBoundingClientRect();
    const element = menu.current;
    if (anchor === undefined || element === null) return;
    capMenu(element, null);
    const fit = fitMenu(anchor, element.offsetHeight, gap);
    capMenu(element, fit.maxHeight);
    const top =
      fit.side === "above"
        ? anchor.top - gap - element.offsetHeight
        : anchor.bottom + gap;
    setPlace({ top, right: window.innerWidth - anchor.right });
    // The first choice takes focus in a choice list, past its back entry.
    menu.current
      ?.querySelector<HTMLElement>(
        shown === -1 ? "[role^=menuitem]:enabled" : "[role=menuitemradio]",
      )
      ?.focus();
  }, [shown]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => close(false);
    // The page moving under the menu closes it (the menu scrolling inside
    // itself does not); the frame that opens it may still be settling its
    // own scroll.
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target))
        return;
      close(false);
    };
    window.addEventListener("resize", onMove);
    const frame = window.requestAnimationFrame(() =>
      document.addEventListener("scroll", onScroll, true),
    );
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onMove);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [close, open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menu.current?.querySelectorAll<HTMLElement>("[role^=menuitem]:enabled") ??
        [],
    );
    const at = items.indexOf(document.activeElement as HTMLElement);
    const focus = (index: number) =>
      items[(index + items.length) % items.length]?.focus();
    switch (event.key) {
      case "ArrowLeft":
        if (view === null) return;
        event.preventDefault();
        back(view);
        return;
      case "ArrowDown":
        event.preventDefault();
        focus(at + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        focus(at - 1);
        return;
      case "Home":
        event.preventDefault();
        focus(0);
        return;
      case "End":
        event.preventDefault();
        focus(items.length - 1);
        return;
      case "Tab":
        close(true);
        return;
      default:
        return;
    }
  };

  const back = useCallback((from: number) => {
    setView(null);
    // The entry that opened the choices takes focus once the list is back.
    window.requestAnimationFrame(() => {
      menu.current
        ?.querySelector<HTMLElement>(`[data-entry="${from}"]`)
        ?.focus();
    });
  }, []);

  // Escape closes the menu, or steps back from the choices; a press outside closes it.
  const contains = useCallback(
    (target: Node) =>
      (menu.current?.contains(target) ?? false) ||
      (button.current?.contains(target) ?? false),
    [],
  );
  const dismiss = useCallback(
    (byKeyboard: boolean) => {
      if (!byKeyboard) close(false);
      else if (view === null) close(true);
      else back(view);
    },
    [back, close, view],
  );
  useMenuDismissal(open, contains, dismiss);

  const chosen = view === null ? null : entries[view];
  const list =
    chosen !== null && chosen !== undefined && chosen.kind === "choices" ? (
      <>
        <button
          className="row-menu-back"
          onClick={() => back(view ?? 0)}
          role="menuitem"
          type="button"
        >
          <span aria-hidden="true">{"\u2039"}</span>
          {chosen.label}
        </button>
        {chosen.note === undefined ? null : (
          <p className="row-menu-note">{chosen.note}</p>
        )}
        {chosen.choices.map((choice) => (
          <button
            aria-checked={choice.checked}
            key={choice.label}
            onClick={() => run(choice.onSelect)}
            role="menuitemradio"
            type="button"
          >
            {choice.label}
            {choice.checked ? <span aria-hidden="true">{"\u2713"}</span> : null}
          </button>
        ))}
      </>
    ) : (
      entries.map((entry, index) => {
        if (entry.kind === "rule")
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: rules have no identity of their own
            <hr className="row-menu-rule" key={index} />
          );
        if (entry.kind === "choices")
          return (
            <button
              aria-haspopup="menu"
              className="row-menu-more"
              data-entry={index}
              key={entry.label}
              onClick={() => setView(index)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight") return;
                event.preventDefault();
                event.stopPropagation();
                setView(index);
              }}
              role="menuitem"
              type="button"
            >
              {entry.label}
              <span aria-hidden="true">{"\u203a"}</span>
            </button>
          );
        return (
          <button
            className={entry.danger ? "is-danger" : undefined}
            disabled={entry.disabled}
            key={entry.label}
            onClick={() => run(entry.onSelect)}
            role="menuitem"
            type="button"
          >
            {entry.label}
          </button>
        );
      })
    );

  return (
    <>
      <button
        aria-controls={open ? id : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="row-more"
        onClick={() => {
          if (open) {
            close(false);
            return;
          }
          // Placed at the button before it renders, so focusing its first
          // entry never scrolls the page to a menu waiting at the end.
          const anchor = button.current?.getBoundingClientRect();
          if (anchor !== undefined)
            setPlace({
              top: anchor.bottom + gap,
              right: window.innerWidth - anchor.right,
            });
          setOpen(true);
        }}
        ref={button}
        type="button"
      >
        <MoreIcon />
      </button>
      {open
        ? createPortal(
            <div
              aria-label={label}
              className="row-menu"
              id={id}
              onKeyDown={onKeyDown}
              ref={menu}
              role="menu"
              style={
                place === null
                  ? { visibility: "hidden" }
                  : { top: place.top, right: place.right }
              }
            >
              {list}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
