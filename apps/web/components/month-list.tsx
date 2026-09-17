"use client";

import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { WeekStart } from "../i18n/active-preferences";
import { shiftCalendarDate, shiftCalendarMonth } from "../lib/calendar-range";
import {
  type DayKey,
  instantDate,
  instantDay,
  parseDayKey,
} from "../lib/day-placement";
import { parseMonthText } from "../lib/due-choices";
import { useDisplayPreferences } from "../lib/use-display-preferences";

/** The names the grid uses in one locale; calendar days take no zone. */
function monthListFormats(locale: string) {
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, options);
  // Weekdays indexed as Date.getDay does: 0 Sunday .. 6 Saturday.
  const weekday = (day: number, options: Intl.DateTimeFormatOptions) =>
    format(options).format(new Date(2026, 0, 4 + day));
  return {
    weekdayHeadings: Array.from({ length: 7 }, (_, day) =>
      weekday(day, { weekday: "narrow" }),
    ),
    weekdayNames: Array.from({ length: 7 }, (_, day) =>
      weekday(day, { weekday: "long" }),
    ),
    monthTitle: format({ month: "long", year: "numeric" }),
    monthNames: Array.from({ length: 12 }, (_, month) =>
      format({ month: "short" }).format(new Date(2000, month, 1)),
    ),
    monthLongNames: Array.from({ length: 12 }, (_, month) =>
      format({ month: "long" }).format(new Date(2000, month, 1)),
    ),
    fullDay: format({
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  };
}

const formatsByLocale = new Map<string, ReturnType<typeof monthListFormats>>();

function formatsFor(locale: string) {
  let formats = formatsByLocale.get(locale);
  if (formats === undefined) {
    formats = monthListFormats(locale);
    formatsByLocale.set(locale, formats);
  }
  return formats;
}

/** How many days a calendar day sits after the first day of its week. */
function columnOf(day: DayKey, firstDay: WeekStart): number {
  return (parseDayKey(day).getDay() - (firstDay % 7) + 7) % 7;
}

/** A month as YYYY-MM. */
export type MonthKey = string;

export const monthOf = (day: DayKey): MonthKey => day.slice(0, 7);
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
 * The weeks of one month, the account's first day first, with the days of
 * other months as empty cells so a day appears once in a continuous list.
 */
function monthWeeks(month: MonthKey, firstDay: WeekStart): (DayKey | null)[][] {
  const start = shiftCalendarDate(
    monthStartOf(month),
    -columnOf(monthStartOf(month), firstDay),
  );
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

/** How a day reads on the grid. */
export interface DayMarks {
  /** The day is chosen: a due date, or an end of a range. */
  readonly pressed?: boolean;
  /** The day lies inside a chosen range. */
  readonly between?: boolean;
}

/**
 * A continuous, scrollable list of months, one six-week month tall, under a
 * heading that names the month at the top and opens a month and year
 * chooser. Arrow keys move by day and week, Page Up and Down by month (with
 * Shift, by year), Home and End to the week's edges.
 */
export function MonthList({
  anchor,
  disabled = false,
  marks,
  now,
  onChooseDay,
  onChooseSpan,
  reveal,
}: {
  /** The roving tab stop when no day has been focused: a choice, or today. */
  readonly anchor: DayKey;
  readonly disabled?: boolean;
  readonly marks: (day: DayKey) => DayMarks;
  /** The present instant; its day is today in the account's zone. */
  readonly now: Date;
  readonly onChooseDay: (day: DayKey) => void;
  /**
   * With this, pressing on a day and dragging across others chooses the
   * span between them, as selecting files in a folder does.
   */
  readonly onChooseSpan?: (from: DayKey, to: DayKey) => void;
  /** A day whose month scrolls to the top whenever it changes. */
  readonly reveal: DayKey;
}) {
  const { locale, firstDay } = useDisplayPreferences();
  const {
    weekdayHeadings,
    weekdayNames,
    monthTitle,
    monthNames,
    monthLongNames,
    fullDay,
  } = formatsFor(locale);
  // The weekday of each column, as Date.getDay numbers them.
  const columns = Array.from(
    { length: 7 },
    (_, index) => ((firstDay % 7) + index) % 7,
  );
  const today = instantDay(now);
  const thisYear = instantDate(now).getFullYear();
  // The month at the top of the list, and the months the list holds.
  const [shown, setShown] = useState<MonthKey>(() => monthOf(reveal));
  const [span, setSpan] = useState(() => ({
    from: shiftMonth(monthOf(reveal), -2),
    to: shiftMonth(monthOf(reveal), 12),
  }));
  const [focusedDay, setFocusedDay] = useState<DayKey | null>(null);
  const [monthOpen, setMonthOpen] = useState(false);
  const [monthText, setMonthText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const chooser = useRef<HTMLDivElement>(null);
  const monthInput = useRef<HTMLInputElement>(null);
  const monthButton = useRef<HTMLButtonElement>(null);
  const yearList = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLButtonElement>(null);
  const focusRequested = useRef<DayKey | null>(null);
  const headingFocusRequested = useRef(false);
  const scrollRequested = useRef<MonthKey | null>(monthOf(reveal));
  const prepended = useRef(0);
  const revealed = useRef(reveal);
  // A press that may become a drag: where it started, whether it moved, and
  // whether the click that follows a drag is to be ignored.
  const drag = useRef({
    anchor: null as DayKey | null,
    moved: false,
    suppressClick: false,
  });

  /**
   * Scrolls a month to the top: within the list as it stands, or, for a
   * month beyond either end, in a list rebuilt around it.
   */
  const revealMonth = (month: MonthKey) => {
    setShown(month);
    scrollRequested.current = month;
    setSpan((current) =>
      month >= current.from && month <= current.to
        ? current
        : { from: shiftMonth(month, -2), to: shiftMonth(month, 12) },
    );
  };

  // A choice made elsewhere brings its month to the top; a drag keeps the
  // list still under the pointer.
  if (reveal !== revealed.current) {
    revealed.current = reveal;
    if (drag.current.anchor === null) revealMonth(monthOf(reveal));
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

  // A press outside the chooser closes it. Blur alone cannot tell, since
  // Safari moves focus to the page rather than to a clicked button.
  useEffect(() => {
    if (!monthOpen) return;
    const onPointerDown = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        target === monthInput.current ||
        target === backdrop.current ||
        chooser.current?.contains(target)
      )
        return;
      setMonthOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [monthOpen]);

  // A drag ends wherever the pointer is released.
  useEffect(() => {
    if (onChooseSpan === undefined) return;
    const release = () => {
      if (drag.current.anchor === null) return;
      drag.current.suppressClick = drag.current.moved;
      drag.current.anchor = null;
      drag.current.moved = false;
    };
    const cancel = () => {
      drag.current.anchor = null;
      drag.current.moved = false;
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [onChooseSpan]);

  const title = monthTitle.format(parseDayKey(monthStartOf(shown)));
  const monthUnreadable =
    monthText.trim() !== "" && parseMonthText(monthText, now) === null;
  const years = Array.from(
    { length: 101 },
    (_, index) => thisYear - 50 + index,
  );
  const months = monthsBetween(span.from, span.to);

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
      Home: () => shiftCalendarDate(day, -columnOf(day, firstDay)),
      End: () => shiftCalendarDate(day, 6 - columnOf(day, firstDay)),
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    focusDay(move());
  };
  const onDayClick = (day: DayKey) => {
    if (drag.current.suppressClick) {
      drag.current.suppressClick = false;
      return;
    }
    onChooseDay(day);
  };
  // A mouse or pen press starts a possible drag; touch scrolls the list.
  const onDayPointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    day: DayKey,
  ) => {
    if (onChooseSpan === undefined) return;
    if (event.pointerType === "touch" || event.button > 0) return;
    drag.current = { anchor: day, moved: false, suppressClick: false };
  };
  const onListPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const { anchor: from } = drag.current;
    if (onChooseSpan === undefined || from === null) return;
    if (event.pointerType === "touch") return;
    const day = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-day]")?.dataset.day;
    if (day === undefined || (day === from && !drag.current.moved)) return;
    drag.current.moved = true;
    if (day < from) onChooseSpan(day, from);
    else onChooseSpan(from, day);
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
  // Focus moving to something outside the chooser closes it; focus lost to
  // the page (a click on a button in Safari) does not.
  const leavesChooser = (related: EventTarget | null) =>
    related instanceof Node &&
    related !== monthInput.current &&
    related !== backdrop.current &&
    !chooser.current?.contains(related);

  // One tab stop among the months: the focused day, else the anchor, else
  // today, else the shown month's first day.
  const inSpan = (day: DayKey) =>
    monthOf(day) >= span.from && monthOf(day) <= span.to;
  const tabStop = focusedDay ?? anchor;
  const tabDay = inSpan(tabStop)
    ? tabStop
    : inSpan(today)
      ? today
      : monthStartOf(shown);

  return (
    <div className="month-list">
      <div className="month-list-nav">
        {monthOpen ? (
          <input
            aria-invalid={monthUnreadable}
            aria-label="Month and year"
            className="month-list-input"
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
            className="month-list-heading"
            disabled={disabled}
            onClick={openMonth}
            ref={monthButton}
            type="button"
          >
            {/* Every month name shares one cell, so the year keeps its place while scrolling. */}
            <span className="month-list-month">
              {monthLongNames.map((name, index) => (
                <span
                  aria-hidden={index !== Number(shown.slice(5, 7)) - 1}
                  className={
                    index === Number(shown.slice(5, 7)) - 1
                      ? undefined
                      : "month-list-month-other"
                  }
                  key={name}
                >
                  {name}
                </span>
              ))}
            </span>
            <span className="month-list-year">{shownYear}</span>
          </button>
        )}
        {monthOpen ? (
          <div
            aria-label="Choose a month and year"
            aria-modal="true"
            className="month-list-chooser"
            onBlur={(event) => {
              if (leavesChooser(event.relatedTarget)) closeMonth();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                finishMonth();
              }
            }}
            // A press on a month or year keeps focus on the typed field, so no
            // browser moves it elsewhere and closes the chooser on the way.
            onMouseDown={(event) => event.preventDefault()}
            ref={chooser}
            role="dialog"
          >
            <div className="month-list-chooser-columns">
              <fieldset className="month-list-chooser-group">
                <legend>Month</legend>
                <div className="month-list-month-grid">
                  {monthNames.map((name, index) => {
                    const key = `${shownYear}-${String(index + 1).padStart(2, "0")}`;
                    return (
                      <button
                        aria-pressed={key === shown}
                        className={`month-list-choice${key === monthOf(today) ? " is-now" : ""}`}
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
              <fieldset className="month-list-chooser-group">
                <legend>Year</legend>
                <div className="month-list-year-grid" ref={yearList}>
                  {years.map((year) => (
                    <button
                      aria-pressed={String(year) === shownYear}
                      className={`month-list-choice${year === thisYear ? " is-now" : ""}`}
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
            <div className="month-list-chooser-footer">
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
            className="month-list-backdrop"
            onClick={finishMonth}
            onMouseDown={(event) => event.preventDefault()}
            ref={backdrop}
            tabIndex={-1}
            type="button"
          />
        ) : null}
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
      <div aria-hidden="true" className="month-list-weekdays">
        {columns.map((weekday) => (
          <span key={weekdayNames[weekday]}>{weekdayHeadings[weekday]}</span>
        ))}
      </div>
      <div
        className={`month-list-months${onChooseSpan ? " is-draggable" : ""}`}
        onPointerMove={onListPointerMove}
        onScroll={onScroll}
        ref={list}
      >
        {months.map((month) => (
          <table
            aria-label={monthTitle.format(parseDayKey(monthStartOf(month)))}
            className="month-list-grid"
            data-month={month}
            key={month}
          >
            <caption className="month-list-caption">
              {monthTitle.format(parseDayKey(monthStartOf(month)))}
            </caption>
            <thead className="visually-hidden">
              <tr>
                {columns.map((weekday) => (
                  <th
                    abbr={weekdayNames[weekday]}
                    aria-label={weekdayNames[weekday]}
                    key={weekdayNames[weekday]}
                    scope="col"
                  >
                    {weekdayHeadings[weekday]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthWeeks(month, firstDay).map((week) => (
                <tr key={week.find((day) => day !== null) ?? month}>
                  {week.map((day, index) => {
                    if (day === null)
                      return (
                        <td
                          key={`${month}-${weekdayNames[columns[index] ?? 0]}`}
                        />
                      );
                    const mark = marks(day);
                    return (
                      <td
                        className={mark.between ? "is-between" : undefined}
                        key={day}
                      >
                        <button
                          aria-label={fullDay.format(parseDayKey(day))}
                          aria-pressed={mark.pressed === true}
                          className={`month-list-day${day < today ? " is-past" : ""}${index === 0 || index === 6 ? " is-weekend" : ""}${day === today ? " is-today" : ""}`}
                          data-day={day}
                          disabled={disabled}
                          onClick={() => onDayClick(day)}
                          onFocus={() => setFocusedDay(day)}
                          onKeyDown={(event) => onGridKey(event, day)}
                          onPointerDown={(event) =>
                            onDayPointerDown(event, day)
                          }
                          tabIndex={day === tabDay ? 0 : -1}
                          type="button"
                        >
                          {parseDayKey(day).getDate()}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
}
