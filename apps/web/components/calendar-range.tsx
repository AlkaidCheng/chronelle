"use client";

import { useId, useState } from "react";

import {
  type CalendarRange,
  describeCalendarRange,
  selectCalendarRange,
} from "../lib/calendar-range";
import { activeLocale } from "../i18n/active-locale";
import { type DayKey, instantDay, parseDayKey } from "../lib/day-placement";
import { dueShortcuts, dueWeekday, parseDueText } from "../lib/due-choices";
import { formatCalendarDate } from "../lib/event-schedule";
import { MonthList } from "./month-list";

/** A calendar day's month and day, short, in the active locale. */
const monthDayShort = (day: DayKey) =>
  new Intl.DateTimeFormat(activeLocale(), {
    month: "short",
    day: "numeric",
  }).format(parseDayKey(day));

const unreadableHint =
  "Not a date the picker knows. Try Sep 21, 21 Sep, 9/21, tomorrow, or 2030-09-21.";

/**
 * A schedule's dates behind a disclosure that reads the range; open, typed
 * Start and End fields, the shortcuts a day allows, and a continuous list of
 * months where the first day chosen starts the range and the second ends
 * it, or a drag across days chooses both.
 */
export function CalendarRangePicker({
  disabled = false,
  now = new Date(),
  onChange,
  value,
}: {
  readonly disabled?: boolean;
  /** Today, for tests. */
  readonly now?: Date;
  readonly onChange: (range: CalendarRange) => void;
  readonly value: CalendarRange;
}) {
  const id = useId();
  const today = instantDay(now);
  const [open, setOpen] = useState(value.startDate === "");
  const [startText, setStartText] = useState(() => exact(value.startDate));
  const [endText, setEndText] = useState(() => exact(value.endDate));
  const [mirrored, setMirrored] = useState(value);
  // The next day chosen on the grid ends the range while a start stands alone.
  const [selectingEnd, setSelectingEnd] = useState(
    value.startDate !== "" && value.endDate === "",
  );
  // The day whose month the list brings to the top: the end last set, else the start.
  const [reveal, setReveal] = useState<DayKey>(
    value.endDate || value.startDate || today,
  );

  // The fields follow a choice made elsewhere; typed text stands on its own.
  if (
    value.startDate !== mirrored.startDate ||
    value.endDate !== mirrored.endDate
  ) {
    setMirrored(value);
    if (value.startDate !== mirrored.startDate)
      setStartText(exact(value.startDate));
    if (value.endDate !== mirrored.endDate) setEndText(exact(value.endDate));
  }

  const startUnreadable =
    startText.trim() !== "" && parseDueText(startText, now) === null;
  const endTyped = endText.trim() === "" ? "" : parseDueText(endText, now);
  const endUnreadable = endTyped === null;
  const endWithoutStart = endTyped !== "" && value.startDate === "";
  const endBeforeStart =
    typeof endTyped === "string" &&
    endTyped !== "" &&
    value.startDate !== "" &&
    endTyped < value.startDate;
  const hint =
    startUnreadable || endUnreadable
      ? unreadableHint
      : endWithoutStart
        ? "Choose a start date first."
        : endBeforeStart
          ? "The end cannot come before the start."
          : "";

  const choose = (range: CalendarRange, shown: DayKey) => {
    setMirrored(range);
    setStartText(exact(range.startDate));
    setEndText(exact(range.endDate));
    setReveal(shown);
    onChange(range);
  };
  const readStart = (text: string) => {
    setStartText(text);
    if (text.trim() === "") {
      setMirrored({ startDate: "", endDate: "" });
      setEndText("");
      setSelectingEnd(false);
      onChange({ startDate: "", endDate: "" });
      return;
    }
    const day = parseDueText(text, now);
    if (day === null) return;
    // An end typed while there was no start now counts, unless it comes first.
    const endDate =
      value.endDate ||
      (endText.trim() === "" ? "" : (parseDueText(endText, now) ?? ""));
    const range = {
      startDate: day,
      endDate: endDate !== "" && endDate < day ? "" : endDate,
    };
    setMirrored(range);
    setEndText(exact(range.endDate));
    setSelectingEnd(range.endDate === "");
    setReveal(day);
    onChange(range);
  };
  const readEnd = (text: string) => {
    setEndText(text);
    if (text.trim() === "") {
      setMirrored({ ...value, endDate: "" });
      setSelectingEnd(value.startDate !== "");
      onChange({ ...value, endDate: "" });
      return;
    }
    const day = parseDueText(text, now);
    if (day === null || value.startDate === "" || day < value.startDate) return;
    const range = { startDate: value.startDate, endDate: day };
    setMirrored(range);
    setSelectingEnd(false);
    setReveal(day);
    onChange(range);
  };
  const chooseDay = (day: DayKey) => {
    const range = selectCalendarRange(value, day, selectingEnd);
    setSelectingEnd(range.endDate === "");
    choose(range, day);
  };
  const chooseSpan = (from: DayKey, to: DayKey) => {
    setSelectingEnd(false);
    choose({ startDate: from, endDate: from === to ? "" : to }, from);
  };

  return (
    <details
      className="range-picker field-wide"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary>Dates: {describeCalendarRange(value)}</summary>
      {open ? (
        <div className="range-panel">
          <div className="range-fields">
            <label className="field">
              <span>Start date</span>
              <input
                aria-describedby={hint === "" ? undefined : `${id}-hint`}
                aria-invalid={startUnreadable}
                disabled={disabled}
                onBlur={() => {
                  if (!startUnreadable) setStartText(exact(value.startDate));
                }}
                onChange={(input) => readStart(input.target.value)}
                placeholder="Sep 21, tomorrow, 2030-09-21"
                type="text"
                value={startText}
              />
            </label>
            <label className="field">
              <span>End date</span>
              <input
                aria-describedby={hint === "" ? undefined : `${id}-hint`}
                aria-invalid={
                  endUnreadable || endWithoutStart || endBeforeStart
                }
                disabled={disabled}
                onBlur={() => {
                  if (!endUnreadable && !endWithoutStart && !endBeforeStart)
                    setEndText(exact(value.endDate));
                }}
                onChange={(input) => readEnd(input.target.value)}
                placeholder="Optional"
                type="text"
                value={endText}
              />
            </label>
          </div>
          {hint === "" ? null : (
            <p className="field-hint" id={`${id}-hint`}>
              {hint}
            </p>
          )}
          <ul aria-label="Schedule shortcuts" className="day-shortcuts">
            {dueShortcuts(now).map((shortcut) => {
              const endDate = shortcut.through ?? "";
              return (
                <li key={shortcut.id}>
                  <button
                    aria-pressed={
                      shortcut.day === value.startDate &&
                      endDate === value.endDate
                    }
                    className="button button-quiet button-small"
                    disabled={disabled}
                    onClick={() => {
                      setSelectingEnd(endDate === "");
                      choose(
                        { startDate: shortcut.day, endDate },
                        shortcut.day,
                      );
                    }}
                    type="button"
                  >
                    <span>{shortcut.label}</span>
                    <span className="day-shortcut-day">
                      {shortcut.id === "next-week"
                        ? `${dueWeekday(shortcut.day)} ${monthDayShort(shortcut.day)}`
                        : shortcut.through === undefined
                          ? dueWeekday(shortcut.day)
                          : `${dueWeekday(shortcut.day)} to ${dueWeekday(shortcut.through)}`}
                    </span>
                  </button>
                </li>
              );
            })}
            <li>
              <button
                aria-pressed={value.startDate === ""}
                className="button button-quiet button-small"
                disabled={disabled}
                onClick={() => {
                  setSelectingEnd(false);
                  choose({ startDate: "", endDate: "" }, today);
                }}
                type="button"
              >
                <span>No dates</span>
              </button>
            </li>
          </ul>
          <MonthList
            anchor={value.startDate || today}
            disabled={disabled}
            marks={(day) => ({
              pressed: day === value.startDate || day === value.endDate,
              between:
                value.endDate !== "" &&
                day > value.startDate &&
                day < value.endDate,
            })}
            now={now}
            onChooseDay={chooseDay}
            onChooseSpan={chooseSpan}
            reveal={reveal}
          />
        </div>
      ) : null}
    </details>
  );
}

function exact(day: string): string {
  return day === "" ? "" : formatCalendarDate(day);
}
