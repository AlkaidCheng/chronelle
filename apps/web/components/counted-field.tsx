"use client";

import {
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  useId,
} from "react";

/** How close to the limit a field's count starts to show. */
const countWithin = 20;

/**
 * A bounded field's count ("n / limit"): shown once the text is within the
 * last twenty characters of the limit, red at the limit, and absent the
 * rest of the time, so a field far from its limit carries no number.
 */
export function FieldCount({
  id,
  limit,
  value,
}: {
  readonly id: string;
  readonly limit: number;
  readonly value: string;
}) {
  return (
    <span
      aria-live="polite"
      className={`field-count${value.length >= limit ? " field-count-full" : ""}`}
      id={id}
    >
      {value.length >= limit - countWithin ? `${value.length} / ${limit}` : ""}
    </span>
  );
}

/**
 * A bounded text field that counts its characters ("n / limit") once the
 * text nears the limit, stops at the limit (a longer paste or composition
 * is cut to it), and turns the count red when the limit is reached. The
 * label names the input on its own; the count, and a hint when there is
 * one, are its description.
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
      <FieldCount id={countId} limit={limit} value={value} />
      {hint === undefined ? null : (
        <span className="field-hint-line" id={hintId}>
          {hint}
        </span>
      )}
    </label>
  );
}
