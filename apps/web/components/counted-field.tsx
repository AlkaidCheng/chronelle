"use client";

import {
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  useId,
} from "react";

/**
 * A bounded text field that counts its characters ("n / limit") as the
 * user types, stops at the limit (a longer paste or composition is cut to
 * it), and turns the count red when the limit is reached. The label names
 * the input on its own; the count, and a hint when there is one, are its
 * description.
 */
export function CountedField({
  className = "",
  hideLabel = false,
  hint,
  inputRef,
  label,
  limit,
  onChange,
  value,
  ...input
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "maxLength" | "onChange" | "value"
> & {
  readonly className?: string;
  /** Keeps the label for assistive technology only. */
  readonly hideLabel?: boolean;
  /** A line under the field saying what to enter. */
  readonly hint?: ReactNode;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly label: ReactNode;
  readonly limit: number;
  readonly onChange: (value: string) => void;
  readonly value: string;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const countId = `${id}-count`;
  const hintId = `${id}-hint`;
  const describedBy = [
    input["aria-describedby"],
    countId,
    hint === undefined ? undefined : hintId,
  ]
    .filter((entry) => entry !== undefined)
    .join(" ");
  return (
    <label className={`field${className === "" ? "" : ` ${className}`}`}>
      <span className={hideLabel ? "visually-hidden" : undefined} id={labelId}>
        {label}
      </span>
      <input
        {...input}
        aria-describedby={describedBy}
        aria-labelledby={labelId}
        maxLength={limit}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onChange(event.target.value.slice(0, limit))
        }
        ref={inputRef}
        value={value}
      />
      <span
        aria-live="polite"
        className={`field-count${value.length >= limit ? " field-count-full" : ""}`}
        id={countId}
      >
        {value.length} / {limit}
      </span>
      {hint === undefined ? null : (
        <span className="field-hint-line" id={hintId}>
          {hint}
        </span>
      )}
    </label>
  );
}
