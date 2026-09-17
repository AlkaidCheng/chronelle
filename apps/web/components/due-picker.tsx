"use client";

import { useId, useState } from "react";

import { type DayKey, dayKeyOf, parseDayKey } from "../lib/day-placement";
import {
  describeDueDay,
  describeRepeat,
  dueShortcuts,
  dueWeekday,
  exactDueDay,
  parseDueText,
  repeatChoices,
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
  repeat = "",
  repeatUntil = "",
): string {
  if (dueDate === "") return "No date";
  const day = describeDueDay(dueDate, now);
  const time =
    dueTime === "" ? day : `${day}, ${formatTime(`${dueDate}T${dueTime}`)}`;
  const timed =
    dueTime === "" || duration === ""
      ? time
      : `${time}, ${formatDuration(Number(duration))}`;
  const rule = describeRepeat(repeat, repeatUntil);
  return rule === "" ? timed : `${timed}, ${rule}`;
}

/** The fields the control owns, as one change. */
interface DueFields {
  readonly dueDate: string;
  readonly dueTime: string;
  readonly duration: string;
  readonly repeat: string;
  readonly repeatUntil: string;
}

/**
 * The task's due behind a disclosure that reads the choice; open, a typed
 * date, the shortcuts a day allows, a continuous list of months with a
 * month and year chooser, a time that stays off until asked for, and a
 * repeat rule with an optional last date. A date alone is due that whole
 * day; without a date there is no time and no rule.
 */
export function DuePicker({
  disabled = false,
  dueDate,
  dueTime,
  duration,
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
  /** Minutes as text, or the empty string for no duration. */
  readonly duration: string;
  /** Today, for tests. */
  readonly now?: Date;
  readonly onChange: (due: DueFields) => void;
  /** A repeat rule, or the empty string for none. */
  readonly repeat?: string;
  /** The last date the rule repeats to, or the empty string for none. */
  readonly repeatUntil?: string;
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
  const [untilText, setUntilText] = useState(() =>
    repeatUntil === "" ? "" : exactDueDay(repeatUntil),
  );
  const [untilDay, setUntilDay] = useState(repeatUntil);

  // The text follows a choice made elsewhere; typed text stands on its own.
  if (dueDate !== textDay) {
    setTextDay(dueDate);
    setText(dueDate === "" ? "" : exactDueDay(dueDate));
  }
  if (repeatUntil !== untilDay) {
    setUntilDay(repeatUntil);
    setUntilText(repeatUntil === "" ? "" : exactDueDay(repeatUntil));
  }

  const showTime = timeOn || dueTime !== "";
  const unreadable = text.trim() !== "" && parseDueText(text, now) === null;
  const untilParsed =
    untilText.trim() === "" ? "" : parseDueText(untilText, now);
  const untilUnreadable = untilParsed === null;
  const untilEarly =
    typeof untilParsed === "string" &&
    untilParsed !== "" &&
    dueDate !== "" &&
    untilParsed < dueDate;

  /** The fields as they stand, with the rule following the date. */
  const fieldsFor = (day: string): DueFields => ({
    dueDate: day,
    dueTime: day === "" ? "" : dueTime,
    duration: day === "" ? "" : duration,
    repeat: day === "" ? "" : repeat,
    // An end before the new date would be refused, so it goes.
    repeatUntil:
      day === "" || (repeatUntil !== "" && repeatUntil < day)
        ? ""
        : repeatUntil,
  });
  const chooseDay = (day: DayKey | "") => {
    setTextDay(day);
    setText(day === "" ? "" : exactDueDay(day));
    onChange(fieldsFor(day));
  };
  const readText = (value: string) => {
    setText(value);
    if (value.trim() === "") {
      setTextDay("");
      onChange(fieldsFor(""));
      return;
    }
    const day = parseDueText(value, now);
    if (day === null) return;
    setTextDay(day);
    onChange(fieldsFor(day));
  };
  const change = (part: Partial<DueFields>) =>
    onChange({ dueDate, dueTime, duration, repeat, repeatUntil, ...part });
  const readUntil = (value: string) => {
    setUntilText(value);
    if (value.trim() === "") {
      setUntilDay("");
      change({ repeatUntil: "" });
      return;
    }
    const day = parseDueText(value, now);
    if (day === null || day < dueDate) return;
    setUntilDay(day);
    change({ repeatUntil: day });
  };
  return (
    <details
      className="due-picker field-wide"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        Due: {describeDue(dueDate, dueTime, duration, now, repeat, repeatUntil)}
      </summary>
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
                  change({ dueTime: "", duration: "" });
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
                      change({
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
                      change({ duration: input.target.value })
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
          <div className="due-repeat">
            <label className="field">
              <span id={`${id}-repeat`}>Repeat</span>
              <select
                aria-labelledby={`${id}-repeat`}
                disabled={disabled || dueDate === ""}
                onChange={(input) =>
                  change({
                    repeat: input.target.value,
                    repeatUntil: input.target.value === "" ? "" : repeatUntil,
                  })
                }
                value={repeat}
              >
                <option value="">Does not repeat</option>
                {repeatChoices().map(([rule, label]) => (
                  <option key={rule} value={rule}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {repeat !== "" ? (
              <label className="field">
                <span>Until</span>
                <input
                  aria-describedby={
                    untilUnreadable || untilEarly
                      ? `${id}-until-hint`
                      : undefined
                  }
                  aria-invalid={untilUnreadable || untilEarly}
                  disabled={disabled}
                  onBlur={() => {
                    if (!untilUnreadable && !untilEarly)
                      setUntilText(
                        repeatUntil === "" ? "" : exactDueDay(repeatUntil),
                      );
                  }}
                  onChange={(input) => readUntil(input.target.value)}
                  placeholder="Optional"
                  type="text"
                  value={untilText}
                />
              </label>
            ) : null}
            {untilUnreadable || untilEarly ? (
              <p className="field-hint" id={`${id}-until-hint`}>
                {untilUnreadable
                  ? "Not a date the picker knows. Try Sep 21, 21 Sep, 9/21, or 2030-09-21."
                  : "The end cannot come before the due date."}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </details>
  );
}
