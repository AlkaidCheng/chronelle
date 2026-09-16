"use client";

import { type ReactNode, useState } from "react";

import {
  type DayKey,
  addDays,
  dayKeyOf,
  monthDays,
  parseDayKey,
  startOfMonth,
  weekDays,
} from "../lib/day-placement";
import { ChevronIcon, RingIcon } from "./icons";

const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const dayOfMonth = new Intl.DateTimeFormat(undefined, { day: "numeric" });
const monthName = new Intl.DateTimeFormat(undefined, { month: "long" });
const monthTitle = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});
const dayTitle = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const fullDayTitle = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

/** The label of the period a cursor falls in: a week's span or a month. */
export function periodLabel(period: "week" | "month", cursor: Date): string {
  if (period === "month") return monthTitle.format(cursor);
  const days = weekDays(cursor);
  const first = parseDayKey(days[0] ?? dayKeyOf(cursor));
  const last = parseDayKey(days[6] ?? dayKeyOf(cursor));
  return `${dayTitle.format(first)} - ${dayTitle.format(last)}${
    last.getFullYear() === new Date().getFullYear()
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
  const label = periodLabel(period, cursor);
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
          direction === 0 ? new Date() : shiftPeriod(period, cursor, direction),
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
      <legend className="visually-hidden">Period</legend>
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
        {step(-1, <ChevronIcon direction="left" />, `Previous ${period}`)}
        {step(0, <RingIcon />, `This ${period}`, "period-today")}
        {step(1, <ChevronIcon direction="right" />, `Next ${period}`)}
      </span>
    </fieldset>
  );
}

/**
 * Seven columns for the week the cursor falls in, Monday first, today
 * marked, scrolling sideways where the panel is narrow; each column
 * renders what the container places on that day.
 */
export function WeekStrip({
  cursor,
  renderDay,
  today = new Date(),
}: {
  readonly cursor: Date;
  /** The nodes of one day, or nothing for an empty column. */
  readonly renderDay: (day: DayKey) => ReactNode;
  readonly today?: Date;
}) {
  const todayKey = dayKeyOf(today);
  return (
    <div className="week-scroll">
      <ol className="week-strip">
        {weekDays(cursor).map((day) => {
          const date = parseDayKey(day);
          return (
            <li
              aria-label={fullDayTitle.format(date)}
              className={`week-day${day === todayKey ? " is-today" : ""}`}
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
  readonly today?: Date;
}) {
  const [expanded, setExpanded] = useState<{
    readonly month: string;
    readonly days: ReadonlySet<DayKey>;
  }>({ month: "", days: new Set() });
  const todayKey = dayKeyOf(today);
  const month = cursor.getMonth();
  const monthKey = dayKeyOf(startOfMonth(cursor)).slice(0, 7);
  const opened =
    expanded.month === monthKey ? expanded.days : new Set<DayKey>();
  const days = monthDays(cursor);
  const weeks = Array.from({ length: days.length / 7 }, (_, week) =>
    days.slice(week * 7, week * 7 + 7),
  );
  return (
    <table className="month-grid">
      <caption className="visually-hidden">{monthTitle.format(cursor)}</caption>
      <thead>
        <tr className="month-weekdays">
          {weekDays(cursor).map((day) => (
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
                  aria-label={`${fullDayTitle.format(date)}${count === 0 ? "" : `, ${count} item${count === 1 ? "" : "s"}`}`}
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
