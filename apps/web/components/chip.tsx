"use client";

import { type ReactNode, type Ref, useCallback, useRef } from "react";

import { usePanelPlacement } from "../lib/use-panel-placement";
import { useMenuDismissal } from "./quiet-menu";

/**
 * One field of the composer as a chip: the field's symbol, then its value,
 * or its name muted while unset, with a clear at the end once set. The
 * chip's button is named for the field and reads its value ("Due: Nov 3");
 * the field's control renders as `children` under the chip while open.
 */
export function Chip({
  buttonRef,
  children,
  clearLabel,
  disabled = false,
  icon,
  label,
  onClear,
  onPress,
  open,
  tone = "",
  value,
}: {
  readonly buttonRef?: Ref<HTMLButtonElement> | undefined;
  readonly children?: ReactNode;
  /** The clear control's name; the clear shows only with this and a value. */
  readonly clearLabel?: string | undefined;
  readonly disabled?: boolean;
  readonly icon: ReactNode;
  /** The field's name, read while unset and as the button's name prefix. */
  readonly label: string;
  readonly onClear?: (() => void) | undefined;
  readonly onPress: () => void;
  /** Whether the chip's control is open under it. */
  readonly open: boolean;
  /** A class marking the value's tone, such as a due today. */
  readonly tone?: string;
  /** What is set, or the empty string. */
  readonly value: string;
}) {
  const set = value !== "";
  return (
    <span className={`chip${set ? " is-set" : ""}${tone ? ` ${tone}` : ""}`}>
      <button
        aria-expanded={open}
        className="chip-main"
        disabled={disabled}
        onClick={onPress}
        ref={buttonRef}
        type="button"
      >
        {icon}
        {set ? <span className="visually-hidden">{label}: </span> : null}
        <span className="chip-text">{set ? value : label}</span>
      </button>
      {set && onClear !== undefined && clearLabel !== undefined ? (
        <button
          aria-label={clearLabel}
          className="chip-clear"
          disabled={disabled}
          onClick={onClear}
          type="button"
        >
          &#215;
        </button>
      ) : null}
      {children}
    </span>
  );
}

/**
 * A chip's control that is not the date panel: a small panel under the
 * chip, fixed to the viewport like the date panel and a sheet on a phone.
 * Escape and a press outside close it; a keyboard close hands focus back
 * to the chip.
 */
export function ChipPanel({
  children,
  label,
  onClose,
}: {
  readonly children: ReactNode;
  /** The panel's accessible name: the field it sets. */
  readonly label: string;
  readonly onClose: (byKeyboard: boolean) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  usePanelPlacement(panel);
  const contains = useCallback(
    (target: Node) =>
      panel.current?.contains(target) === true ||
      panel.current?.parentElement?.contains(target) === true,
    [],
  );
  useMenuDismissal(true, contains, onClose);
  return (
    <div aria-label={label} className="chip-panel" ref={panel} role="dialog">
      {children}
    </div>
  );
}
