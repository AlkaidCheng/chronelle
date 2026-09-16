"use client";

import { useId, useState } from "react";

import { type DayKey, dayKeyOf, parseDayKey } from "../lib/day-placement";
import {
  describeDueDay,
  dueShortcuts,
  dueWeekday,
  exactDueDay,
  parseDueText,
} from "../lib/due-choices";
import { formatDuration, formatTime } from "../lib/format";
import { MonthList } from "./month-list";

const monthDayShort = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const weekdayLong = new Intl.DateTimeFormat(undefined, { weekday: "long" });

/** The durations offered, in minutes. */
export const durationChoices = [
  15, 30, 45, 60, 90, 120, 180, 240, 480,
] as const;

/** What a due choice reads as on the closed control. */
export function describeDue(
  dueDate: string,
  dueTime: string,
  duration = "",
  now: Date = new Date(),
): string {
  if (dueDate === "") return "No date";
  const day = describeDueDay(dueDate, now);
  if (dueTime === "") return day;
  const time = `${day}, ${formatTime(`${dueDate}T${dueTime}`)}`;
  return duration === ""
    ? time
    : `${time}, ${formatDuration(Number(duration))}`;
}

/**
 * The task's due behind a disclosure that reads the choice; open, a typed
 * date, the shortcuts a day allows, a continuous list of months with a
 * month and year chooser, and a time that stays off until asked for. A
 * date alone is due that whole day.
 */
export function DuePicker({
  disabled = false,
  dueDate,
  dueTime,
  duration,
  now = new Date(),
  onChange,
}: {
  readonly disabled?: boolean;
  /** A calendar date, or the empty string for no due date. */
  readonly dueDate: string;
  /** A local time of day, or the empty string for none. */
  readonly dueTime: string;
  /** Minutes as text, or the empty string for no duration. */
  readonly duration: string;
  /** Today, for tests. */
  readonly now?: Date;
  readonly onChange: (due: {
    dueDate: string;
    dueTime: string;
    duration: string;
  }) => void;
}) {
  const id = useId();
  const today = dayKeyOf(now);
  const tomorrow = dayKeyOf(new Date(now.getTime() + 86_400_000));
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() =>
    dueDate === "" ? "" : exactDueDay(dueDate),
  );
  const [textDay, setTextDay] = useState(dueDate);
  const [timeOn, setTimeOn] = useState(dueTime !== "");

  // The text follows a choice made elsewhere; typed text stands on its own.
  if (dueDate !== textDay) {
    setTextDay(dueDate);
    setText(dueDate === "" ? "" : exactDueDay(dueDate));
  }

  const showTime = timeOn || dueTime !== "";
  const unreadable = text.trim() !== "" && parseDueText(text, now) === null;

  const chooseDay = (day: DayKey | "") => {
    setTextDay(day);
    setText(day === "" ? "" : exactDueDay(day));
    onChange({
      dueDate: day,
      dueTime: day === "" ? "" : dueTime,
      duration: day === "" ? "" : duration,
    });
  };
  const readText = (value: string) => {
    setText(value);
    if (value.trim() === "") {
      setTextDay("");
      onChange({ dueDate: "", dueTime: "", duration: "" });
      return;
    }
    const day = parseDueText(value, now);
    if (day === null) return;
    setTextDay(day);
    onChange({ dueDate: day, dueTime, duration });
  };
  return (
    <details
      className="due-picker field-wide"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Due: {describeDue(dueDate, dueTime, duration, now)}</summary>
      {open ? (
        <div className="due-panel">
          <label className="field">
            <span>Due date</span>
            <input
              aria-describedby={
                unreadable || dueDate !== "" ? `${id}-date-hint` : undefined
              }
              aria-invalid={unreadable}
              disabled={disabled}
              onBlur={() => {
                if (!unreadable)
                  setText(dueDate === "" ? "" : exactDueDay(dueDate));
              }}
              onChange={(input) => readText(input.target.value)}
              placeholder="Sep 21, tomorrow, 2030-09-21"
              type="text"
              value={text}
            />
          </label>
          {unreadable || dueDate !== "" ? (
            <p className="field-hint" id={`${id}-date-hint`}>
              {unreadable
                ? "Not a date the picker knows. Try Sep 21, 21 Sep, 9/21, tomorrow, or 2030-09-21."
                : `Due ${weekdayLong.format(parseDayKey(dueDate))}${
                    dueDate === today
                      ? ", today"
                      : dueDate === tomorrow
                        ? ", tomorrow"
                        : ""
                  }.`}
            </p>
          ) : null}
          <ul aria-label="Due shortcuts" className="day-shortcuts">
            {dueShortcuts(now).map((shortcut) => (
              <li key={shortcut.id}>
                <button
                  aria-pressed={shortcut.day === dueDate}
                  className="button button-quiet button-small"
                  disabled={disabled}
                  onClick={() => chooseDay(shortcut.day)}
                  type="button"
                >
                  <span>{shortcut.label}</span>
                  <span className="day-shortcut-day">
                    {shortcut.id === "next-week"
                      ? `${dueWeekday(shortcut.day)} ${monthDayShort.format(parseDayKey(shortcut.day))}`
                      : dueWeekday(shortcut.day)}
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button
                aria-pressed={dueDate === ""}
                className="button button-quiet button-small"
                disabled={disabled}
                onClick={() => chooseDay("")}
                type="button"
              >
                <span>No date</span>
              </button>
            </li>
          </ul>
          <MonthList
            anchor={dueDate || today}
            disabled={disabled}
            marks={(day) => ({ pressed: day === dueDate })}
            now={now}
            onChooseDay={chooseDay}
            reveal={dueDate || today}
          />
          <div className="due-time">
            <button
              aria-pressed={showTime}
              className="button button-quiet button-small"
              disabled={disabled || dueDate === ""}
              onClick={() => {
                if (showTime) {
                  setTimeOn(false);
                  onChange({ dueDate, dueTime: "", duration: "" });
                } else setTimeOn(true);
              }}
              type="button"
            >
              {showTime ? "Remove time" : "Add time"}
            </button>
            {showTime ? (
              <div className="due-time-fields">
                <label className="field">
                  <span>Due time</span>
                  <input
                    disabled={disabled}
                    onChange={(input) =>
                      onChange({
                        dueDate,
                        dueTime: input.target.value,
                        duration: input.target.value === "" ? "" : duration,
                      })
                    }
                    type="time"
                    value={dueTime}
                  />
                </label>
                <label className="field">
                  <span id={`${id}-duration`}>Duration</span>
                  <select
                    aria-labelledby={`${id}-duration`}
                    disabled={disabled || dueTime === ""}
                    onChange={(input) =>
                      onChange({
                        dueDate,
                        dueTime,
                        duration: input.target.value,
                      })
                    }
                    value={duration}
                  >
                    <option value="">No duration</option>
                    {durationChoices.map((minutes) => (
                      <option key={minutes} value={String(minutes)}>
                        {formatDuration(minutes)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
            {showTime ? (
              <p className="field-hint">
                {`Times are in ${Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll("_", " ")}.`}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </details>
  );
}
