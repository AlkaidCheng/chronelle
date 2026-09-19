"use client";

import {
  createContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  capMenu,
  fitMenu,
  menuEdge,
  viewportSize,
} from "../lib/menu-placement";
import { IconButton } from "./icon-button";

const CloseContext = createContext<((returnFocus?: boolean) => void) | null>(
  null,
);

/**
 * Keeps an open list inside the viewport. It opens upward when it would
 * run under the bottom (or the phone's rail) and there is room above
 * (`data-place="up"`, which the stylesheet anchors to the control's top),
 * and is capped to the roomier side and scrolls when it fits neither. A
 * list cut off at a side of the viewport swaps its horizontal anchor
 * (`data-align`) when the other edge fits it whole, else keeps its side
 * and is nudged into view.
 */
export function useMenuPlacement(
  open: boolean,
  menu: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const element = menu.current;
    if (!open || element === null) return;
    delete element.dataset.place;
    delete element.dataset.align;
    element.style.marginLeft = "";
    capMenu(element, null);
    const anchor = element.offsetParent?.getBoundingClientRect();
    if (anchor === undefined) return;
    const fit = fitMenu(anchor, element.offsetHeight, 4);
    if (fit.side === "above") element.dataset.place = "up";
    capMenu(element, fit.maxHeight);
    const bounds = element.getBoundingClientRect();
    if (sidewaysOverflow(bounds) === 0) return;
    const { width } = viewportSize();
    element.dataset.align = bounds.right > width ? "end" : "start";
    if (sidewaysOverflow(element.getBoundingClientRect()) === 0) return;
    delete element.dataset.align;
    element.style.marginLeft = `${
      bounds.right > width
        ? width - bounds.right - menuEdge
        : menuEdge - bounds.left
    }px`;
  }, [open, menu]);
}

/** How far a list runs past the viewport's left or right edge. */
function sidewaysOverflow(bounds: DOMRect): number {
  return (
    Math.max(0, bounds.right - viewportSize().width) + Math.max(0, -bounds.left)
  );
}

/**
 * Closes an open menu on Escape anywhere in the document or on a press
 * outside it. The document listens for Escape because a pointer press does
 * not focus the pressed control in every browser, so a key handler on the
 * list alone would miss it.
 */
export function useMenuDismissal(
  open: boolean,
  contains: (target: Node) => boolean,
  onClose: (byKeyboard: boolean) => void,
) {
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && contains(event.target)) return;
      onClose(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose(true);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [contains, onClose, open]);
}

function menuItems(menu: HTMLElement | null) {
  return Array.from(
    menu?.querySelectorAll<HTMLElement>(
      '[role^="menuitem"]:not([aria-disabled="true"])',
    ) ?? [],
  );
}

/**
 * Moves focus between a menu's items on the arrow, Home, and End keys and
 * reports Tab, which leaves the menu. Returns whether the key was handled.
 */
export function moveMenuFocus(
  event: ReactKeyboardEvent<HTMLElement>,
  menu: HTMLElement | null,
): "moved" | "left" | "ignored" {
  const all = menuItems(menu);
  const index = all.indexOf(document.activeElement as HTMLElement);
  const go = (next: number) => {
    event.preventDefault();
    all.at(((next % all.length) + all.length) % all.length)?.focus();
    return "moved" as const;
  };
  if (event.key === "ArrowDown") return go(index + 1);
  if (event.key === "ArrowUp") return go(index - 1);
  if (event.key === "Home") return go(0);
  if (event.key === "End") return go(all.length - 1);
  if (event.key === "Tab") return "left";
  return "ignored";
}

/** Focuses a menu's first item once it opens. */
export function focusFirstMenuItem(menu: HTMLElement | null) {
  menuItems(menu)[0]?.focus();
}

/**
 * A quiet control that opens a small menu beneath it: an icon control, or
 * with `text` a chip that shows the icon and that text (the current choice,
 * for a menu that picks one). Arrow keys move between items, Escape or a
 * press outside closes it, and focus returns to the control. `checked` on
 * an item renders a radio-style entry.
 */
export function QuietMenu({
  label,
  icon,
  text,
  children,
  align = "end",
  active = false,
  className = "",
  value,
}: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly text?: string | undefined;
  readonly children: ReactNode;
  readonly align?: "start" | "end";
  readonly active?: boolean;
  readonly className?: string;
  readonly value?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useMenuPlacement(open, menu);

  useEffect(() => {
    if (open) focusFirstMenuItem(menu.current);
  }, [open]);

  const contains = useCallback(
    (target: Node) => root.current?.contains(target) ?? false,
    [],
  );
  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }, []);
  useMenuDismissal(open, contains, close);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (moveMenuFocus(event, menu.current) === "left") close(false);
  }

  return (
    <div className={`quiet-menu ${className}`.trim()} ref={root}>
      {text === undefined ? (
        <IconButton
          ref={trigger}
          label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={`${id}-menu`}
          data-active={active || undefined}
          data-value={value}
          onClick={() => setOpen((current) => !current)}
        >
          {icon}
        </IconButton>
      ) : (
        <button
          ref={trigger}
          type="button"
          className="quiet-menu-chip"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={`${id}-menu`}
          data-value={value}
          onClick={() => setOpen((current) => !current)}
        >
          {icon}
          <span>{text}</span>
        </button>
      )}
      {open ? (
        <CloseContext.Provider value={close}>
          <div
            ref={menu}
            id={`${id}-menu`}
            role="menu"
            aria-label={label}
            className={`quiet-menu-list quiet-menu-${align}`}
            onKeyDown={onKeyDown}
          >
            {children}
          </div>
        </CloseContext.Provider>
      ) : null}
    </div>
  );
}

/** A keyboard shortcut as a menu item shows it: the label people read, and the `aria-keyshortcuts` value. */
export interface MenuShortcut {
  readonly label: string;
  readonly keys: string;
}

export function MenuItem({
  children,
  onSelect,
  checked,
  disabled = false,
  tone = "neutral",
  icon,
  hint,
  shortcut,
}: {
  readonly children: ReactNode;
  readonly onSelect: () => void;
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly tone?: "neutral" | "danger";
  readonly icon?: ReactNode;
  /** A second line under the label: what the item will do, or why it cannot. */
  readonly hint?: string | undefined;
  /** The keys that run the item from outside the menu, shown at its end. */
  readonly shortcut?: MenuShortcut | undefined;
}) {
  const close = useContext(CloseContext);
  const shared = {
    type: "button" as const,
    "aria-disabled": disabled || undefined,
    "aria-keyshortcuts": shortcut?.keys,
    tabIndex: -1,
    className: `quiet-menu-item quiet-menu-${tone}`,
    title: hint,
    onClick: () => {
      if (disabled) return;
      close?.();
      onSelect();
    },
  };
  const body = (
    <>
      {icon}
      <span>{children}</span>
      {shortcut === undefined ? null : (
        <span aria-hidden="true" className="quiet-menu-key">
          {shortcut.label}
        </span>
      )}
      {checked ? (
        <svg
          aria-hidden="true"
          className="quiet-menu-check"
          viewBox="0 0 24 24"
        >
          <path d="M5 12l4 4L19 6" />
        </svg>
      ) : null}
      {hint === undefined ? null : (
        <span className="quiet-menu-hint">{hint}</span>
      )}
    </>
  );
  if (checked !== undefined)
    return (
      <button {...shared} role="menuitemradio" aria-checked={checked}>
        {body}
      </button>
    );
  return (
    <button {...shared} role="menuitem">
      {body}
    </button>
  );
}

export function MenuSeparator() {
  return <hr className="quiet-menu-separator" />;
}

/** A section label inside a menu, above the items it names. */
export function MenuHeading({ children }: { readonly children: ReactNode }) {
  return <p className="quiet-menu-heading">{children}</p>;
}
