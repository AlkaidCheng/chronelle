"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useMenuDismissal, useMenuPlacement } from "./quiet-menu";

/** One line of a heading menu: a choice, a toggle, an action, a section label, or a rule. */
export type HeadMenuEntry =
  | {
      readonly kind: "radio";
      readonly label: string;
      readonly checked: boolean;
      readonly onSelect: () => void;
      /** Whether choosing closes the menu; a filter menu stays open. */
      readonly closes?: boolean;
    }
  | {
      readonly kind: "check";
      readonly label: string;
      readonly checked: boolean;
      readonly onSelect: () => void;
    }
  | {
      readonly kind: "item";
      readonly label: string;
      readonly onSelect: () => void;
    }
  | { readonly kind: "label"; readonly text: string }
  | { readonly kind: "rule" };

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return menu === null
    ? []
    : [...menu.querySelectorAll<HTMLElement>("[role^='menuitem']")];
}

/**
 * A quiet heading control, an icon and the current choice, that opens a
 * narrow menu below it. Radio items choose one value and close, check
 * items toggle and keep the menu open, plain items run. Arrow keys move,
 * Home and End jump, Escape or a press outside closes and returns focus.
 */
export function HeadMenu({
  active = false,
  busy = false,
  entries,
  icon,
  label,
  name,
}: {
  /** Marks the control as holding a choice other than its default. */
  readonly active?: boolean;
  readonly busy?: boolean;
  readonly entries: readonly HeadMenuEntry[];
  readonly icon: ReactNode;
  /** The control's purpose (Layout, Sort, Filter): the menu's name, and the button's when no choice is shown. */
  readonly label: string;
  /** The current choice shown on the button, when there is one to show. */
  readonly name?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useMenuPlacement(open, menu);

  useEffect(() => {
    if (!open) return;
    const items = menuItems(menu.current);
    (
      items.find((item) => item.getAttribute("aria-checked") === "true") ??
      items[0]
    )?.focus();
  }, [open]);

  const contains = useCallback(
    (target: Node) => root.current?.contains(target) ?? false,
    [],
  );
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);
  useMenuDismissal(open, contains, close);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = menuItems(menu.current);
    const index = items.findIndex((item) => item === document.activeElement);
    const focus = (next: number) => {
      event.preventDefault();
      items[((next % items.length) + items.length) % items.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        focus(index + 1);
        return;
      case "ArrowUp":
        focus(index - 1);
        return;
      case "Home":
        focus(0);
        return;
      case "End":
        focus(items.length - 1);
        return;
      case "Tab":
        setOpen(false);
        return;
      default:
    }
  }

  return (
    <div className="head-menu" ref={root}>
      <button
        aria-controls={`${id}-menu`}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`button button-quiet head-menu-button${active ? " is-active" : ""}`}
        disabled={busy}
        onClick={() => setOpen((current) => !current)}
        ref={trigger}
        type="button"
      >
        {icon}
        {name === undefined ? (
          <span>{label}</span>
        ) : (
          <>
            <span className="visually-hidden">{label}: </span>
            <span>{name}</span>
          </>
        )}
      </button>
      {open ? (
        <div
          aria-label={label}
          className="head-menu-list"
          id={`${id}-menu`}
          onKeyDown={onKeyDown}
          ref={menu}
          role="menu"
        >
          {entries.map((entry, index) => {
            const key = `${index}:${entry.kind === "rule" ? "" : entry.kind === "label" ? entry.text : entry.label}`;
            switch (entry.kind) {
              case "rule":
                return <div className="head-menu-rule" key={key} />;
              case "label":
                return (
                  <div className="head-menu-label" key={key}>
                    {entry.text}
                  </div>
                );
              case "radio":
                return (
                  <button
                    aria-checked={entry.checked}
                    key={key}
                    onClick={() => {
                      entry.onSelect();
                      if (entry.closes !== false) close(true);
                    }}
                    role="menuitemradio"
                    type="button"
                  >
                    <span>{entry.label}</span>
                  </button>
                );
              case "check":
                return (
                  <button
                    aria-checked={entry.checked}
                    key={key}
                    onClick={entry.onSelect}
                    role="menuitemcheckbox"
                    type="button"
                  >
                    <span>{entry.label}</span>
                  </button>
                );
              case "item":
                return (
                  <button
                    key={key}
                    onClick={() => {
                      entry.onSelect();
                      close(true);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span>{entry.label}</span>
                  </button>
                );
              default:
                return null;
            }
          })}
        </div>
      ) : null}
    </div>
  );
}
