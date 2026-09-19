"use client";

import type { ReactNode, Ref } from "react";

/**
 * One row of an editor for a field set through a control that opens under
 * it: the field's symbol, then the value, or the field's name with a hint
 * while unset, and a clear at the end once set. The row's button is named
 * for the field and reads its value; the control renders as `children`
 * while open.
 */
export function FieldRow({
  buttonRef,
  children,
  className = "",
  clearLabel,
  disabled = false,
  expanded,
  hint,
  icon,
  label,
  onClear,
  onPress,
  value,
}: {
  readonly buttonRef?: Ref<HTMLButtonElement> | undefined;
  readonly children?: ReactNode;
  readonly className?: string;
  /** The clear control's name; the clear shows only with this and a value. */
  readonly clearLabel?: string | undefined;
  readonly disabled?: boolean;
  /** Whether the row's control is open under it; absent for a row that edits in place. */
  readonly expanded?: boolean | undefined;
  /** Under the name while unset: what the field is for. */
  readonly hint?: string | undefined;
  readonly icon: ReactNode;
  /** The field's name, read while unset and as the button's name prefix. */
  readonly label: string;
  readonly onClear?: (() => void) | undefined;
  readonly onPress: () => void;
  /** What is set, or the empty string. */
  readonly value: string;
}) {
  const set = value !== "";
  return (
    <div className={`field-row${set ? " is-set" : ""} ${className}`.trim()}>
      <button
        aria-expanded={expanded}
        className="field-row-main"
        disabled={disabled}
        onClick={onPress}
        ref={buttonRef}
        type="button"
      >
        {icon}
        <span className="field-row-text">
          {set ? <span className="visually-hidden">{label}: </span> : null}
          <strong className={`field-row-value${set ? "" : " is-unset"}`}>
            {set ? value : label}
          </strong>
          {!set && hint !== undefined ? (
            <small className="field-row-hint">{hint}</small>
          ) : null}
        </span>
      </button>
      {set && onClear !== undefined && clearLabel !== undefined ? (
        <button
          aria-label={clearLabel}
          className="field-row-clear"
          disabled={disabled}
          onClick={onClear}
          type="button"
        >
          &#215;
        </button>
      ) : null}
      {children}
    </div>
  );
}
