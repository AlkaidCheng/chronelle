"use client";

import { useRef, useState } from "react";

import { formatDateTime, fromDateTimeInput } from "../lib/format";
import { DatePanel } from "./date-panel";
import { FieldRow } from "./field-row";
import { ClockIcon } from "./icons";

/**
 * A row for one timed moment kept as a datetime-local value: it reads the
 * day and time in the account's locale, or what it is for while unset, and
 * opens the date panel with the time unfolded. A day chosen without a time
 * takes `defaultTime`, so the moment is always complete.
 */
export function MomentRow({
  clearLabel,
  defaultTime,
  disabled = false,
  hint,
  label,
  now = new Date(),
  onChange,
  setLabel,
  value,
}: {
  readonly clearLabel: string;
  /** The local time a day takes until one is typed, as HH:MM. */
  readonly defaultTime: string;
  readonly disabled?: boolean;
  readonly hint?: string | undefined;
  /** The field's name once set, and the panel's name. */
  readonly label: string;
  /** Today, for tests. */
  readonly now?: Date;
  readonly onChange: (value: string) => void;
  /** What the row reads while unset. */
  readonly setLabel: string;
  /** A datetime-local value, or the empty string. */
  readonly value: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const day = value.slice(0, 10);
  const time = value.slice(11, 16);
  const instant = fromDateTimeInput(value);
  return (
    <FieldRow
      buttonRef={button}
      className="moment-row"
      clearLabel={clearLabel}
      disabled={disabled}
      expanded={open}
      hint={hint}
      icon={<ClockIcon className="field-row-icon" />}
      label={value === "" ? setLabel : label}
      onClear={() => onChange("")}
      onPress={() => setOpen((current) => !current)}
      value={instant === null ? "" : formatDateTime(instant)}
    >
      {open ? (
        <DatePanel
          disabled={disabled}
          kind="day"
          label={label}
          now={now}
          onChange={(next) =>
            onChange(
              next.day === ""
                ? ""
                : `${next.day}T${next.time === "" ? defaultTime : next.time}`,
            )
          }
          onClose={(byKeyboard) => {
            setOpen(false);
            if (byKeyboard) button.current?.focus();
          }}
          timeOpen
          timeRequired
          value={{ day, time }}
        />
      ) : null}
    </FieldRow>
  );
}
