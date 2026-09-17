"use client";

import {
  createContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { IconButton } from "./icon-button";

const CloseContext = createContext<((returnFocus?: boolean) => void) | null>(
  null,
);

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
 * A quiet icon control that opens a small menu beneath it. Arrow keys move
 * between items, Escape or a press outside closes it, and focus returns to
 * the control. `checked` on an item renders a radio-style entry.
 */
export function QuietMenu({
  label,
  icon,
  children,
  align = "end",
  active = false,
  className = "",
  value,
}: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly children: ReactNode;
  readonly align?: "start" | "end";
  readonly active?: boolean;
  readonly className?: string;
  readonly value?: string;
}) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState(align);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  // Keep the list inside the viewport: flip it when the preferred side would
  // run off the document's edge, which otherwise scrolls the page sideways.
  useLayoutEffect(() => {
    if (!open) {
      setSide(align);
      return;
    }
    const bounds = menu.current?.getBoundingClientRect();
    if (!bounds) return;
    const width = document.documentElement.clientWidth;
    if (align === "start" && bounds.right > width) setSide("end");
    else if (align === "end" && bounds.left < 0) setSide("start");
  }, [open, align]);

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
      {open ? (
        <CloseContext.Provider value={close}>
          <div
            ref={menu}
            id={`${id}-menu`}
            role="menu"
            aria-label={label}
            className={`quiet-menu-list quiet-menu-${side}`}
            onKeyDown={onKeyDown}
          >
            {children}
          </div>
        </CloseContext.Provider>
      ) : null}
    </div>
  );
}

export function MenuItem({
  children,
  onSelect,
  checked,
  disabled = false,
  tone = "neutral",
  icon,
  hint,
}: {
  readonly children: ReactNode;
  readonly onSelect: () => void;
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly tone?: "neutral" | "danger";
  readonly icon?: ReactNode;
  /** A second line under the label: what the item will do, or why it cannot. */
  readonly hint?: string | undefined;
}) {
  const close = useContext(CloseContext);
  const shared = {
    type: "button" as const,
    "aria-disabled": disabled || undefined,
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
      <span>
        {children}
        {hint === undefined ? null : (
          <span className="quiet-menu-hint">{hint}</span>
        )}
      </span>
      {checked ? (
        <svg
          aria-hidden="true"
          className="quiet-menu-check"
          viewBox="0 0 24 24"
        >
          <path d="M5 12l4 4L19 6" />
        </svg>
      ) : null}
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
