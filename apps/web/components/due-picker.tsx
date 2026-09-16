"use client";

import {
  type KeyboardEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { shiftCalendarDate, shiftCalendarMonth } from "../lib/calendar-range";
import { type DayKey, dayKeyOf, parseDayKey } from "../lib/day-placement";
import {
  describeDueDay,
  dueShortcuts,
  dueWeekday,
  parseDueText,
} from "../lib/due-choices";
import { formatDuration, formatTime } from "../lib/format";

const weekdayHeadings = Array.from({ length: 7 }, (_, day) =>
  new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(
    new Date(2026, 0, 4 + day),
  ),
);
const weekdayNames = Array.from({ length: 7 }, (_, day) =>
  new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(
    new Date(2026, 0, 4 + day),
  ),
);
const monthTitle = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});
const fullDay = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

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

/** The six weeks of a month, Sunday first, as day keys. */
function monthWeeks(monthStart: DayKey): DayKey[][] {
  const first = parseDayKey(monthStart);
  const start = shiftCalendarDate(monthStart, -first.getDay());
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) =>
      shiftCalendarDate(start, week * 7 + day),
    ),
  );
}

/**
 * The task's due behind a disclosure that reads the choice; open, a typed
 * date, the shortcuts a day allows, one month at a time, and a time that
 * stays off until asked for. A date alone is due that whole day.
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
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() =>
    dueDate === "" ? "" : describeDueDay(dueDate, now),
  );
  const [textDay, setTextDay] = useState(dueDate);
  const [cursor, setCursor] = useState(() => dueDate || today);
  const [focusedDay, setFocusedDay] = useState<DayKey | null>(null);
  const [timeOn, setTimeOn] = useState(dueTime !== "");
  const grid = useRef<HTMLTableElement>(null);
  const focusRequested = useRef<DayKey | null>(null);
  // Focus follows a keyboard move once the month it lands in has rendered.
  useLayoutEffect(() => {
    const day = focusRequested.current;
    if (day === null) return;
    focusRequested.current = null;
    grid.current
      ?.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)
      ?.focus();
  });
  // The text follows a choice made elsewhere; typed text stands on its own.
  if (dueDate !== textDay) {
    setTextDay(dueDate);
    setText(dueDate === "" ? "" : describeDueDay(dueDate, now));
    if (dueDate !== "") setCursor(dueDate);
  }
  const showTime = timeOn || dueTime !== "";
  const unreadable = text.trim() !== "" && parseDueText(text, now) === null;
  const monthStart = `${cursor.slice(0, 7)}-01`;
  const weeks = monthWeeks(monthStart);
  const month = cursor.slice(0, 7);

  const chooseDay = (day: DayKey | "") => {
    setTextDay(day);
    setText(day === "" ? "" : describeDueDay(day, now));
    if (day !== "") setCursor(day);
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
    setCursor(day);
    onChange({ dueDate: day, dueTime, duration });
  };
  const focusDay = (day: DayKey) => {
    focusRequested.current = day;
    setFocusedDay(day);
    setCursor(day);
  };
  const onGridKey = (event: KeyboardEvent<HTMLButtonElement>, day: DayKey) => {
    const moves: Record<string, () => DayKey> = {
      ArrowLeft: () => shiftCalendarDate(day, -1),
      ArrowRight: () => shiftCalendarDate(day, 1),
      ArrowUp: () => shiftCalendarDate(day, -7),
      ArrowDown: () => shiftCalendarDate(day, 7),
      PageUp: () => shiftCalendarMonth(day, event.shiftKey ? -12 : -1),
      PageDown: () => shiftCalendarMonth(day, event.shiftKey ? 12 : 1),
      Home: () => shiftCalendarDate(day, -parseDayKey(day).getDay()),
      End: () => shiftCalendarDate(day, 6 - parseDayKey(day).getDay()),
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    focusDay(move());
  };
  const tabStop = focusedDay ?? dueDate ?? "";
  const tabDay =
    tabStop !== "" && tabStop.startsWith(month)
      ? tabStop
      : today.startsWith(month)
        ? today
        : monthStart;

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
              aria-describedby={`${id}-date-hint`}
              aria-invalid={unreadable}
              disabled={disabled}
              onChange={(input) => readText(input.target.value)}
              placeholder="Sep 21, tomorrow, 2030-09-21"
              type="text"
              value={text}
            />
          </label>
          <p className="field-hint" id={`${id}-date-hint`}>
            {unreadable
              ? "Not a date the picker knows. Try Sep 21, 21 Sep, 9/21, tomorrow, or 2030-09-21."
              : dueDate === ""
                ? "No due date. Type one, pick a shortcut, or choose a day."
                : `${fullDay.format(parseDayKey(dueDate))}.`}
          </p>
          <ul aria-label="Due shortcuts" className="due-shortcuts">
            {dueShortcuts(now, dueDate || null).map((shortcut) => (
              <li key={shortcut.id}>
                <button
                  className="button button-quiet button-small"
                  disabled={disabled}
                  onClick={() => chooseDay(shortcut.day)}
                  type="button"
                >
                  <span>{shortcut.label}</span>
                  <span className="due-shortcut-day">
                    {shortcut.id === "next-week"
                      ? `${dueWeekday(shortcut.day)} ${describeDueDay(shortcut.day, now)}`
                      : dueWeekday(shortcut.day)}
                  </span>
                </button>
              </li>
            ))}
            {dueDate === "" ? null : (
              <li>
                <button
                  className="button button-quiet button-small"
                  disabled={disabled}
                  onClick={() => chooseDay("")}
                  type="button"
                >
                  <span>No date</span>
                </button>
              </li>
            )}
          </ul>
          <div className="due-month">
            <div className="due-month-nav">
              <strong aria-live="polite">
                {monthTitle.format(parseDayKey(monthStart))}
              </strong>
              <div>
                <button
                  aria-label="Previous month"
                  className="button button-quiet button-small"
                  disabled={disabled}
                  onClick={() => setCursor(shiftCalendarMonth(monthStart, -1))}
                  type="button"
                >
                  &#8249;
                </button>
                <button
                  aria-label="This month"
                  className="button button-quiet button-small"
                  disabled={disabled}
                  onClick={() => setCursor(today)}
                  type="button"
                >
                  &#9679;
                </button>
                <button
                  aria-label="Next month"
                  className="button button-quiet button-small"
                  disabled={disabled}
                  onClick={() => setCursor(shiftCalendarMonth(monthStart, 1))}
                  type="button"
                >
                  &#8250;
                </button>
              </div>
            </div>
            <table
              aria-label={monthTitle.format(parseDayKey(monthStart))}
              className="due-grid"
              ref={grid}
            >
              <thead>
                <tr>
                  {weekdayHeadings.map((heading, index) => (
                    <th
                      abbr={weekdayNames[index]}
                      key={weekdayNames[index]}
                      scope="col"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week) => (
                  <tr key={week[0]}>
                    {week.map((day) => {
                      const date = parseDayKey(day);
                      const inMonth = day.startsWith(month);
                      const weekend =
                        date.getDay() === 0 || date.getDay() === 6;
                      return (
                        <td key={day}>
                          <button
                            aria-label={fullDay.format(date)}
                            aria-pressed={day === dueDate}
                            className={`due-day${inMonth ? "" : " is-outside"}${day < today ? " is-past" : ""}${weekend ? " is-weekend" : ""}${day === today ? " is-today" : ""}`}
                            data-day={day}
                            disabled={disabled}
                            onClick={() => chooseDay(day)}
                            onFocus={() => setFocusedDay(day)}
                            onKeyDown={(event) => onGridKey(event, day)}
                            tabIndex={day === tabDay ? 0 : -1}
                            type="button"
                          >
                            {date.getDate()}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            <p className="field-hint">
              {dueDate === ""
                ? "Choose a date before a time."
                : showTime
                  ? `Times are in ${Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll("_", " ")}.`
                  : "Without a time, the task is due that whole day."}
            </p>
          </div>
        </div>
      ) : null}
    </details>
  );
}
