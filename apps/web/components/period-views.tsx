"use client";

import { type ReactNode, useState } from "react";

import { activeLocale, tr } from "../i18n/active-locale";
import { activeWeekStart, type WeekStart } from "../i18n/active-preferences";
import {
  addDays,
  type DayKey,
  dayKeyOf,
  instantDay,
  monthDays,
  parseDayKey,
  startOfMonth,
  today as todayIn,
  weekDays,
} from "../lib/day-placement";
import { useDisplayPreferences } from "../lib/use-display-preferences";
import { ChevronIcon, RingIcon } from "./icons";

/** The formats of calendar days (local-midnight Dates) in one locale; no zone applies to them. */
function dayFormats(locale: string) {
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, options);
  return {
    weekdayShort: format({ weekday: "short" }),
    dayOfMonth: format({ day: "numeric" }),
    monthName: format({ month: "long" }),
    monthTitle: format({ month: "long", year: "numeric" }),
    dayTitle: format({ month: "short", day: "numeric" }),
    fullDayTitle: format({
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  };
}

const formatsByLocale = new Map<string, ReturnType<typeof dayFormats>>();

function formatsFor(locale: string) {
  let formats = formatsByLocale.get(locale);
  if (formats === undefined) {
    formats = dayFormats(locale);
    formatsByLocale.set(locale, formats);
  }
  return formats;
}

/** The label of the period a cursor falls in: a week's span or a month. */
export function periodLabel(
  period: "week" | "month",
  cursor: Date,
  locale: string = activeLocale(),
  weekStart: WeekStart = activeWeekStart(locale),
): string {
  const { monthTitle, dayTitle } = formatsFor(locale);
  if (period === "month") return monthTitle.format(cursor);
  const days = weekDays(cursor, weekStart);
  const first = parseDayKey(days[0] ?? dayKeyOf(cursor));
  const last = parseDayKey(days[6] ?? dayKeyOf(cursor));
  return `${dayTitle.format(first)} - ${dayTitle.format(last)}${
    last.getFullYear() === todayIn().getFullYear()
      ? ""
      : `, ${last.getFullYear()}`
  }`;
}

/** The cursor moved by one period in either direction. */
export function shiftPeriod(
  period: "week" | "month",
  cursor: Date,
  direction: -1 | 1,
): Date {
  if (period === "week") return addDays(cursor, 7 * direction);
  const first = startOfMonth(cursor);
  return new Date(first.getFullYear(), first.getMonth() + direction, 1);
}

/**
 * The period's title at the left (a month reads as its name in bold with
 * the year after it) and three quiet icon buttons at the right: previous,
 * this week or month (a plain ring), next.
 */
export function PeriodNav({
  cursor,
  onChange,
  period,
}: {
  readonly cursor: Date;
  readonly onChange: (cursor: Date) => void;
  readonly period: "week" | "month";
}) {
  const { locale, firstDay } = useDisplayPreferences();
  const { monthName } = formatsFor(locale);
  const label = periodLabel(period, cursor, locale, firstDay);
  const nav = tr("periodNav");
  const step = (
    direction: -1 | 0 | 1,
    icon: ReactNode,
    name: string,
    className?: string,
  ) => (
    <button
      aria-label={name}
      className={className}
      onClick={() =>
        onChange(
          direction === 0 ? todayIn() : shiftPeriod(period, cursor, direction),
        )
      }
      title={name}
      type="button"
    >
      {icon}
    </button>
  );
  return (
    <fieldset className="period-nav">
      <legend className="visually-hidden">{nav("period")}</legend>
      <span aria-live="polite" className="period-label">
        {period === "month" ? (
          <>
            <strong>{monthName.format(cursor)}</strong> {cursor.getFullYear()}
            <span className="visually-hidden">{`, ${label}`}</span>
          </>
        ) : (
          label
        )}
      </span>
      <span className="period-steps">
        {step(-1, <ChevronIcon direction="left" />, nav(`previous.${period}`))}
        {step(0, <RingIcon />, nav(`this.${period}`), "period-today")}
        {step(1, <ChevronIcon direction="right" />, nav(`next.${period}`))}
      </span>
    </fieldset>
  );
}

/**
 * Seven columns for the week the cursor falls in, the account's first day
 * first, today marked, each at least 180px wide so a title reads as words,
 * scrolling sideways where the panel is narrower than that; each column
 * renders what the container places on that day, then the container's
 * footer for the day.
 */
export function WeekStrip({
  cursor,
  renderDay,
  renderFooter,
  today = new Date(),
}: {
  readonly cursor: Date;
  /** The nodes of one day, its rows even when it holds none. */
  readonly renderDay: (day: DayKey) => ReactNode;
  /** What ends a column, under its rows. */
  readonly renderFooter?: ((day: DayKey) => ReactNode) | undefined;
  /** The present instant; its day is marked in the account's zone. */
  readonly today?: Date;
}) {
  const { locale, firstDay } = useDisplayPreferences();
  const { weekdayShort, dayTitle, fullDayTitle } = formatsFor(locale);
  const todayKey = instantDay(today);
  return (
    <div className="week-scroll">
      <ol className="week-strip">
        {weekDays(cursor, firstDay).map((day) => {
          const date = parseDayKey(day);
          return (
            <li
              aria-label={fullDayTitle.format(date)}
              className={`week-day${day === todayKey ? " is-today" : ""}`}
              data-drop-zone=""
              key={day}
            >
              <h3 className="week-day-heading">
                <span>{weekdayShort.format(date)}</span>
                <small>
                  {dayTitle.format(date)}
                  {day === todayKey ? <> &middot; Today</> : null}
                </small>
              </h3>
              <div className="week-day-items">{renderDay(day)}</div>
              {renderFooter?.(day)}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** One column of a board: a day, or a strip's items (overdue, undated) as a column. */
export interface BoardColumn<Item> {
  /** The drop group of the column's rows: the day, or the strip's key. */
  readonly key: string;
  /** The day the column holds; null for a strip's column. */
  readonly day: DayKey | null;
  readonly items: readonly Item[];
  /** The label of a strip's column; a day names itself. */
  readonly label?: string | undefined;
  readonly tone: "overdue" | "today" | "plain" | "undated";
  /** A control at the column's head, such as Overdue's Reschedule. */
  readonly action?: ReactNode;
}

/**
 * Columns that scroll sideways, one per day that holds something in date
 * order, with the strips' columns at either end: Overdue first and Today
 * always (even empty, so its add row has a home), the undated last. Each
 * column renders what the container places in it, then the container's
 * footer; a phone shows one column and a half at a time.
 */
export function BoardStrip<Item>({
  columns,
  renderColumn,
  renderFooter,
}: {
  readonly columns: readonly BoardColumn<Item>[];
  /** The nodes of one column, its rows even when it holds none. */
  readonly renderColumn: (column: BoardColumn<Item>) => ReactNode;
  /** What ends a column, under its rows. */
  readonly renderFooter?:
    ((column: BoardColumn<Item>) => ReactNode) | undefined;
}) {
  const { locale } = useDisplayPreferences();
  const { weekdayShort, dayTitle, fullDayTitle } = formatsFor(locale);
  const board = tr("board");
  const heading = (column: BoardColumn<Item>) => {
    if (column.day === null) {
      const label = column.label ?? "";
      return { title: label, name: label, after: null };
    }
    const date = parseDayKey(column.day);
    return {
      title: dayTitle.format(date),
      name: fullDayTitle.format(date),
      after:
        column.tone === "today" ? board("today") : weekdayShort.format(date),
    };
  };
  return (
    <div className="board-scroll">
      <ol className="board-strip">
        {columns.map((column) => {
          const { title, name, after } = heading(column);
          return (
            <li
              aria-label={name}
              className={`board-column is-${column.tone}`}
              data-drop-zone=""
              key={column.key}
            >
              <h3 className="board-heading">
                <span className="board-title">
                  {title}
                  {after === null ? null : <small> &middot; {after}</small>}
                </span>
                <span className="board-count">
                  <span className="visually-hidden">
                    {board("count", { count: column.items.length })}
                  </span>
                  <span aria-hidden="true">{column.items.length}</span>
                </span>
                {column.action}
              </h3>
              <div className="board-items">{renderColumn(column)}</div>
              {renderFooter?.(column)}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** How many rows a month cell shows before folding the rest behind "+N more". */
export const monthCellRows = 3;

/**
 * The weeks of the cursor's month as a grid of day cells: weekday names
 * and day numbers at the right, today a filled circle, days of other
 * months muted with the first of a month named, the grid ending with the
 * week that holds the month's last day. Each cell shows three rows and
 * folds the rest behind "+N more", which opens the day in place.
 */
export function MonthGrid({
  countOf,
  cursor,
  renderDay,
  today = new Date(),
}: {
  /** How many items the day holds. */
  readonly countOf: (day: DayKey) => number;
  readonly cursor: Date;
  /** The day's rows, the first `limit` of them unless the limit is null. */
  readonly renderDay: (day: DayKey, limit: number | null) => ReactNode;
  /** The present instant; its day is marked in the account's zone. */
  readonly today?: Date;
}) {
  const [expanded, setExpanded] = useState<{
    readonly month: string;
    readonly days: ReadonlySet<DayKey>;
  }>({ month: "", days: new Set() });
  const { locale, firstDay } = useDisplayPreferences();
  const { weekdayShort, dayOfMonth, monthTitle, dayTitle, fullDayTitle } =
    formatsFor(locale);
  const todayKey = instantDay(today);
  const month = cursor.getMonth();
  const monthKey = dayKeyOf(startOfMonth(cursor)).slice(0, 7);
  const opened =
    expanded.month === monthKey ? expanded.days : new Set<DayKey>();
  const days = monthDays(cursor, firstDay);
  const weeks = Array.from({ length: days.length / 7 }, (_, week) =>
    days.slice(week * 7, week * 7 + 7),
  );
  return (
    <table className="month-grid">
      <caption className="visually-hidden">{monthTitle.format(cursor)}</caption>
      <thead>
        <tr className="month-weekdays">
          {weekDays(cursor, firstDay).map((day) => (
            <th key={day} scope="col">
              {weekdayShort.format(parseDayKey(day))}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr className="month-week" key={week[0]}>
            {week.map((day) => {
              const date = parseDayKey(day);
              const count = countOf(day);
              const isOpen = opened.has(day);
              const hidden = isOpen ? 0 : Math.max(0, count - monthCellRows);
              return (
                <td
                  aria-label={tr("periodNav")("dayCell", {
                    day: fullDayTitle.format(date),
                    count,
                  })}
                  className={`month-day${date.getMonth() === month ? "" : " is-outside"}${day === todayKey ? " is-today" : ""}${count === 0 ? "" : " has-items"}`}
                  key={day}
                >
                  <span className="month-day-number">
                    <span>
                      {date.getDate() === 1
                        ? dayTitle.format(date)
                        : dayOfMonth.format(date)}
                    </span>
                  </span>
                  {count === 0
                    ? null
                    : renderDay(day, isOpen ? null : monthCellRows)}
                  {hidden === 0 ? null : (
                    <button
                      className="month-day-more"
                      onClick={() =>
                        setExpanded({
                          month: monthKey,
                          days: new Set([...opened, day]),
                        })
                      }
                      type="button"
                    >
                      +{hidden} more
                    </button>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
