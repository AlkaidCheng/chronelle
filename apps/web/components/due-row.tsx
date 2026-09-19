"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { tr } from "../i18n/active-locale";
import { describeDueDay, describeRepeat } from "../lib/due-choices";
import { formatTime, fromDateTimeInput } from "../lib/format";
import { DatePanel } from "./date-panel";
import { FieldRow } from "./field-row";
import { CalendarIcon } from "./icons";

/** What a due reads as on its row: the exact day, the time, the rule. */
export function describeDue(
  dueDate: string,
  dueTime: string,
  now: Date = new Date(),
  repeat = "",
  repeatUntil = "",
): string {
  if (dueDate === "") return tr("dueField")("noDate");
  const day = describeDueDay(dueDate, now);
  const timed =
    dueTime === ""
      ? day
      : `${day}, ${formatTime(fromDateTimeInput(`${dueDate}T${dueTime}`) ?? "")}`;
  const rule = describeRepeat(repeat, repeatUntil);
  return rule === "" ? timed : `${timed}, ${rule}`;
}

/** The fields the row owns, as one change. */
export interface DueFields {
  readonly dueDate: string;
  readonly dueTime: string;
  readonly repeat: string;
  readonly repeatUntil: string;
}

/**
 * A task's due as one row: the exact day with today or tomorrow as a hint,
 * the time, and the rule, or "Set due date" while unset. Pressing it opens
 * the date panel with Time and Repeat; the clear at its end drops the due
 * with its time and rule.
 */
export function DueRow({
  disabled = false,
  dueDate,
  dueTime,
  now = new Date(),
  onChange,
  repeat = "",
  repeatUntil = "",
}: {
  readonly disabled?: boolean;
  /** A calendar date, or the empty string for no due date. */
  readonly dueDate: string;
  /** A local time of day, or the empty string for none. */
  readonly dueTime: string;
  /** Today, for tests. */
  readonly now?: Date;
  readonly onChange: (due: DueFields) => void;
  /** A repeat rule, or the empty string for none. */
  readonly repeat?: string;
  /** The last date the rule repeats to, or the empty string for none. */
  readonly repeatUntil?: string;
}) {
  const t = useTranslations("dueField");
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = (byKeyboard: boolean) => {
    setOpen(false);
    if (byKeyboard) button.current?.focus();
  };
  return (
    <FieldRow
      buttonRef={button}
      className="due-row"
      clearLabel={t("clear")}
      disabled={disabled}
      expanded={open}
      hint={t("hint")}
      icon={<CalendarIcon className="field-row-icon" />}
      label={dueDate === "" ? t("setDue") : t("dueDate")}
      onClear={() =>
        onChange({ dueDate: "", dueTime: "", repeat: "", repeatUntil: "" })
      }
      onPress={() => setOpen((current) => !current)}
      value={
        dueDate === ""
          ? ""
          : describeDue(dueDate, dueTime, now, repeat, repeatUntil)
      }
    >
      {open ? (
        <DatePanel
          disabled={disabled}
          kind="day"
          label={t("dueDate")}
          now={now}
          onChange={(value) =>
            onChange({
              dueDate: value.day,
              dueTime: value.time,
              repeat: value.day === "" ? "" : repeat,
              // An end before the new date would be refused, so it goes.
              repeatUntil:
                value.day === "" ||
                (repeatUntil !== "" && repeatUntil < value.day)
                  ? ""
                  : repeatUntil,
            })
          }
          onClose={close}
          onRepeatChange={(rule) =>
            onChange({
              dueDate,
              dueTime,
              repeat: rule.rule,
              repeatUntil: rule.until,
            })
          }
          repeat={{ rule: repeat, until: repeatUntil }}
          value={{ day: dueDate, time: dueTime }}
        />
      ) : null}
    </FieldRow>
  );
}
