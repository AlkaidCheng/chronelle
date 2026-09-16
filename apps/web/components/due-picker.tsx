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
  exactDueDay,
  parseDueText,
  parseMonthText,
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
const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat(undefined, { month: "short" }).format(
    new Date(2000, month, 1),
  ),
);
const monthLongNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat(undefined, { month: "long" }).format(
    new Date(2000, month, 1),
  ),
);
const monthDayShort = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const weekdayLong = new Intl.DateTimeFormat(undefined, { weekday: "long" });
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

/** A month as YYYY-MM. */
type MonthKey = string;

const monthOf = (day: DayKey): MonthKey => day.slice(0, 7);
const monthStartOf = (month: MonthKey): DayKey => `${month}-01`;
const shiftMonth = (month: MonthKey, by: number): MonthKey =>
  monthOf(shiftCalendarMonth(monthStartOf(month), by));

/** The months from one to another, inclusive. */
function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const months: MonthKey[] = [];
  for (let month = from; month <= to; month = shiftMonth(month, 1))
    months.push(month);
  return months;
}

/**
 * The weeks of one month, Sunday first, with the days of other months as
 * empty cells so a day appears once in a continuous list.
 */
function monthWeeks(month: MonthKey): (DayKey | null)[][] {
  const first = parseDayKey(monthStartOf(month));
  const start = shiftCalendarDate(monthStartOf(month), -first.getDay());
  const weeks: (DayKey | null)[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const days = Array.from({ length: 7 }, (_, day) => {
      const key = shiftCalendarDate(start, week * 7 + day);
      return monthOf(key) === month ? key : null;
    });
    if (days.every((day) => day === null)) break;
    weeks.push(days);
  }
  return weeks;
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
  // The month at the top of the list, and the months the list holds.
  const [shown, setShown] = useState<MonthKey>(() => monthOf(dueDate || today));
  const [span, setSpan] = useState(() => {
    const anchor = monthOf(dueDate || today);
    return { from: shiftMonth(anchor, -2), to: shiftMonth(anchor, 12) };
  });
  const [focusedDay, setFocusedDay] = useState<DayKey | null>(null);
  const [timeOn, setTimeOn] = useState(dueTime !== "");
  const [monthOpen, setMonthOpen] = useState(false);
  const [monthText, setMonthText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const chooser = useRef<HTMLDivElement>(null);
  const monthInput = useRef<HTMLInputElement>(null);
  const monthButton = useRef<HTMLButtonElement>(null);
  const yearList = useRef<HTMLDivElement>(null);
  const focusRequested = useRef<DayKey | null>(null);
  const headingFocusRequested = useRef(false);
  const scrollRequested = useRef<MonthKey | null>(null);
  const prepended = useRef(0);

  /** Makes a month part of the list and scrolls it to the top. */
  const revealMonth = (month: MonthKey) => {
    setShown(month);
    scrollRequested.current = month;
    setSpan((current) => ({
      from: month < current.from ? shiftMonth(month, -2) : current.from,
      to: month > current.to ? shiftMonth(month, 6) : current.to,
    }));
  };

  // The text follows a choice made elsewhere; typed text stands on its own.
  if (dueDate !== textDay) {
    setTextDay(dueDate);
    setText(dueDate === "" ? "" : exactDueDay(dueDate));
    if (dueDate !== "") revealMonth(monthOf(dueDate));
  }

  // After a render: keep the scroll position when months were added above,
  // scroll a requested month to the top, and focus a requested day.
  useLayoutEffect(() => {
    const container = list.current;
    if (container === null) return;
    if (prepended.current > 0) {
      const tables = container.querySelectorAll<HTMLElement>("[data-month]");
      let height = 0;
      for (let index = 0; index < prepended.current; index += 1)
        height += tables[index]?.offsetHeight ?? 0;
      container.scrollTop += height;
      prepended.current = 0;
    }
    const month = scrollRequested.current;
    if (month !== null) {
      scrollRequested.current = null;
      const target = container.querySelector<HTMLElement>(
        `[data-month="${month}"]`,
      );
      if (target) container.scrollTop = target.offsetTop;
    }
    const day = focusRequested.current;
    if (day !== null) {
      focusRequested.current = null;
      container
        .querySelector<HTMLButtonElement>(`[data-day="${day}"]`)
        ?.focus();
    }
  });

  // Opening the chooser selects its typed field; a deliberate close returns
  // focus to the heading.
  useLayoutEffect(() => {
    if (monthOpen) {
      monthInput.current?.focus();
      monthInput.current?.select();
    } else if (headingFocusRequested.current) {
      headingFocusRequested.current = false;
      monthButton.current?.focus();
    }
  }, [monthOpen]);

  // The chooser's year grid keeps the shown year in view without moving a
  // year the pointer is on.
  const shownYear = shown.slice(0, 4);
  useLayoutEffect(() => {
    const grid = yearList.current;
    const chosen = grid?.querySelector<HTMLButtonElement>(
      `[data-year="${shownYear}"]`,
    );
    if (!monthOpen || !grid || !chosen) return;
    const above = chosen.offsetTop < grid.scrollTop;
    const below =
      chosen.offsetTop + chosen.offsetHeight >
      grid.scrollTop + grid.clientHeight;
    // The shown year's row lands second, with one row of earlier years above it.
    if (above || below)
      grid.scrollTop = chosen.offsetTop - chosen.offsetHeight - 4;
  }, [monthOpen, shownYear]);

  const showTime = timeOn || dueTime !== "";
  const unreadable = text.trim() !== "" && parseDueText(text, now) === null;
  const title = monthTitle.format(parseDayKey(monthStartOf(shown)));
  const monthUnreadable =
    monthText.trim() !== "" && parseMonthText(monthText, now) === null;
  const years = Array.from(
    { length: 101 },
    (_, index) => now.getFullYear() - 50 + index,
  );
  const months = monthsBetween(span.from, span.to);

  const chooseDay = (day: DayKey | "") => {
    setTextDay(day);
    setText(day === "" ? "" : exactDueDay(day));
    if (day !== "") revealMonth(monthOf(day));
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
    revealMonth(monthOf(day));
    onChange({ dueDate: day, dueTime, duration });
  };
  const focusDay = (day: DayKey) => {
    focusRequested.current = day;
    setFocusedDay(day);
    const month = monthOf(day);
    if (month < span.from || month > span.to) revealMonth(month);
    else setShown(month);
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
  // Scrolling extends the list at either end and names the month at the top.
  const onScroll = () => {
    const container = list.current;
    if (container === null) return;
    if (container.scrollTop < 60) {
      prepended.current = 3;
      setSpan((current) => ({
        ...current,
        from: shiftMonth(current.from, -3),
      }));
    } else if (
      container.scrollHeight - container.scrollTop - container.clientHeight <
      120
    )
      setSpan((current) => ({ ...current, to: shiftMonth(current.to, 3) }));
    let top: MonthKey | null = null;
    for (const table of container.querySelectorAll<HTMLElement>(
      "[data-month]",
    )) {
      if (table.offsetTop - container.scrollTop <= 4)
        top = table.dataset.month ?? null;
      else break;
    }
    if (top !== null && top !== shown) setShown(top);
  };
  const openMonth = () => {
    setMonthText(title);
    setMonthOpen(true);
  };
  // Closing because focus left keeps focus where it went; closing on purpose
  // (Done, Escape, the backdrop) returns it to the heading.
  const closeMonth = () => setMonthOpen(false);
  const finishMonth = () => {
    headingFocusRequested.current = true;
    setMonthOpen(false);
  };
  const leavesChooser = (related: EventTarget | null) =>
    !(related instanceof Node) ||
    (related !== monthInput.current && !chooser.current?.contains(related));

  // One tab stop among the months: the choice, else today, else the shown month's first day.
  const tabStop = focusedDay ?? dueDate;
  const inSpan = (day: DayKey) =>
    monthOf(day) >= span.from && monthOf(day) <= span.to;
  const tabDay =
    tabStop !== "" && inSpan(tabStop)
      ? tabStop
      : inSpan(today)
        ? today
        : monthStartOf(shown);

  return (
    <details
      className="due-picker field-wide"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (event.currentTarget.open) revealMonth(monthOf(dueDate || today));
      }}
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
                : `Due ${weekdayLong.format(parseDayKey(dueDate))}${
                    dueDate === today
                      ? ", today"
                      : dueDate === tomorrow
                        ? ", tomorrow"
                        : ""
                  }.`}
          </p>
          <ul aria-label="Due shortcuts" className="due-shortcuts">
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
                  <span className="due-shortcut-day">
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
          <div className="due-month">
            <div className="due-month-nav">
              {monthOpen ? (
                <input
                  aria-invalid={monthUnreadable}
                  aria-label="Month and year"
                  className="due-month-input"
                  disabled={disabled}
                  onBlur={(event) => {
                    if (leavesChooser(event.relatedTarget)) closeMonth();
                  }}
                  onChange={(input) => {
                    setMonthText(input.target.value);
                    const next = parseMonthText(input.target.value, now);
                    if (next !== null) revealMonth(next);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === "Escape") {
                      event.preventDefault();
                      finishMonth();
                    }
                  }}
                  placeholder="October 2027, 2027-10, 10/2027"
                  ref={monthInput}
                  type="text"
                  value={monthText}
                />
              ) : (
                <button
                  aria-expanded={false}
                  aria-label={`Choose a month and year, showing ${title}`}
                  className="due-month-button"
                  disabled={disabled}
                  onClick={openMonth}
                  ref={monthButton}
                  type="button"
                >
                  {/* Every month name shares one cell, so the year keeps its place while scrolling. */}
                  <span className="due-month-name">
                    {monthLongNames.map((name, index) => (
                      <span
                        aria-hidden={index !== Number(shown.slice(5, 7)) - 1}
                        className={
                          index === Number(shown.slice(5, 7)) - 1
                            ? undefined
                            : "due-month-name-other"
                        }
                        key={name}
                      >
                        {name}
                      </span>
                    ))}
                  </span>
                  <span className="due-month-year">{shown.slice(0, 4)}</span>
                </button>
              )}
              <div>
                <button
                  aria-label="Previous month"
                  className="button button-quiet button-small"
                  disabled={disabled}
                  onClick={() => revealMonth(shiftMonth(shown, -1))}
                  type="button"
                >
                  &#8249;
                </button>
                <button
                  className="button button-quiet button-small"
                  disabled={disabled || shown === monthOf(today)}
                  onClick={() => revealMonth(monthOf(today))}
                  type="button"
                >
                  Today
                </button>
                <button
                  aria-label="Next month"
                  className="button button-quiet button-small"
                  disabled={disabled}
                  onClick={() => revealMonth(shiftMonth(shown, 1))}
                  type="button"
                >
                  &#8250;
                </button>
              </div>
            </div>
            {monthOpen ? (
              <div
                aria-label="Choose a month and year"
                aria-modal="true"
                className="due-month-panel"
                onBlur={(event) => {
                  if (leavesChooser(event.relatedTarget)) closeMonth();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    finishMonth();
                  }
                }}
                ref={chooser}
                role="dialog"
              >
                <div className="due-month-columns">
                  <fieldset className="due-month-group">
                    <legend>Month</legend>
                    <div className="due-month-grid">
                      {monthNames.map((name, index) => {
                        const key = `${shownYear}-${String(index + 1).padStart(2, "0")}`;
                        return (
                          <button
                            aria-pressed={key === shown}
                            className={`due-month-choice${key === monthOf(today) ? " is-now" : ""}`}
                            key={name}
                            onClick={() => revealMonth(key)}
                            type="button"
                          >
                            {name}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                  <fieldset className="due-month-group">
                    <legend>Year</legend>
                    <div className="due-year-grid" ref={yearList}>
                      {years.map((year) => (
                        <button
                          aria-pressed={String(year) === shownYear}
                          className={`due-month-choice${year === now.getFullYear() ? " is-now" : ""}`}
                          data-year={year}
                          key={year}
                          onClick={() =>
                            revealMonth(`${year}-${shown.slice(5, 7)}`)
                          }
                          type="button"
                        >
                          {year}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </div>
                <div className="due-month-footer">
                  <span aria-live="polite" className="field-hint">
                    Showing {title}
                  </span>
                  <button
                    className="button button-small"
                    onClick={finishMonth}
                    type="button"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : null}
            {monthOpen ? (
              <button
                aria-label="Close the month and year chooser"
                className="due-month-backdrop"
                onClick={finishMonth}
                tabIndex={-1}
                type="button"
              />
            ) : null}
            <div aria-hidden="true" className="due-weekdays">
              {weekdayHeadings.map((heading, index) => (
                <span key={weekdayNames[index]}>{heading}</span>
              ))}
            </div>
            <div className="due-months" onScroll={onScroll} ref={list}>
              {months.map((month) => (
                <table
                  aria-label={monthTitle.format(
                    parseDayKey(monthStartOf(month)),
                  )}
                  className="due-grid"
                  data-month={month}
                  key={month}
                >
                  <caption className="due-grid-caption">
                    {monthTitle.format(parseDayKey(monthStartOf(month)))}
                  </caption>
                  <thead className="visually-hidden">
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
                    {monthWeeks(month).map((week) => (
                      <tr key={week.find((day) => day !== null) ?? month}>
                        {week.map((day, index) =>
                          day === null ? (
                            <td key={`${month}-${weekdayNames[index]}`} />
                          ) : (
                            <td key={day}>
                              <button
                                aria-label={fullDay.format(parseDayKey(day))}
                                aria-pressed={day === dueDate}
                                className={`due-day${day < today ? " is-past" : ""}${index === 0 || index === 6 ? " is-weekend" : ""}${day === today ? " is-today" : ""}`}
                                data-day={day}
                                disabled={disabled}
                                onClick={() => chooseDay(day)}
                                onFocus={() => setFocusedDay(day)}
                                onKeyDown={(event) => onGridKey(event, day)}
                                tabIndex={day === tabDay ? 0 : -1}
                                type="button"
                              >
                                {parseDayKey(day).getDate()}
                              </button>
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
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
