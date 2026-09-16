"use client";

import type { ReactNode } from "react";

import {
  type DayKey,
  addDays,
  dayKeyOf,
  monthDays,
  parseDayKey,
  startOfMonth,
  weekDays,
} from "../lib/day-placement";

const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const dayOfMonth = new Intl.DateTimeFormat(undefined, { day: "numeric" });
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

/** Previous / Today / Next around the period's label. */
export function PeriodNav({
  cursor,
  onChange,
  period,
}: {
  readonly cursor: Date;
  readonly onChange: (cursor: Date) => void;
  readonly period: "week" | "month";
}) {
  return (
    <fieldset className="period-nav">
      <legend className="visually-hidden">Period</legend>
      <button
        aria-label={`Previous ${period}`}
        className="button button-quiet button-small"
        onClick={() => onChange(shiftPeriod(period, cursor, -1))}
        type="button"
      >
        &#8249;
      </button>
      <button
        className="button button-quiet button-small"
        onClick={() => onChange(new Date())}
        type="button"
      >
        Today
      </button>
      <button
        aria-label={`Next ${period}`}
        className="button button-quiet button-small"
        onClick={() => onChange(shiftPeriod(period, cursor, 1))}
        type="button"
      >
        &#8250;
      </button>
      <span aria-live="polite" className="period-label">
        {periodLabel(period, cursor)}
      </span>
    </fieldset>
  );
}

/**
 * Seven columns for the week the cursor falls in, Monday first, today
 * marked; each column renders what the container places on that day.
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
              <strong>{dayOfMonth.format(date)}</strong>
            </h3>
            <div className="week-day-items">{renderDay(day)}</div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Six weeks of days covering the cursor's month, days outside the month
 * dimmed, today marked, one day selectable; each cell shows up to three
 * compact nodes and counts the rest.
 */
export function MonthGrid({
  cursor,
  onSelect,
  renderItem,
  selected,
  today = new Date(),
}: {
  readonly cursor: Date;
  readonly onSelect: (day: DayKey) => void;
  /** The compact nodes of one day, keyed, in order; the cell shows the first three. */
  readonly renderItem: (
    day: DayKey,
  ) => readonly { readonly key: string; readonly node: ReactNode }[];
  readonly selected: DayKey | null;
  readonly today?: Date;
}) {
  const todayKey = dayKeyOf(today);
  const month = cursor.getMonth();
  const days = monthDays(cursor);
  const weeks = Array.from({ length: 6 }, (_, week) =>
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
              const items = renderItem(day);
              const shown = items.slice(0, 3);
              return (
                <td
                  className={`month-day${date.getMonth() === month ? "" : " is-outside"}${day === todayKey ? " is-today" : ""}${selected === day ? " is-selected" : ""}${items.length === 0 ? "" : " has-items"}`}
                  key={day}
                >
                  <button
                    aria-label={`${fullDayTitle.format(date)}${items.length === 0 ? "" : `, ${items.length} item${items.length === 1 ? "" : "s"}`}`}
                    aria-pressed={selected === day}
                    className="month-day-button"
                    onClick={() => onSelect(day)}
                    type="button"
                  >
                    <span className="month-day-number">
                      {dayOfMonth.format(date)}
                    </span>
                    <span className="month-day-items">
                      {shown.map((item) => (
                        <span className="month-day-item" key={item.key}>
                          {item.node}
                        </span>
                      ))}
                      {items.length > shown.length ? (
                        <span className="month-day-more">
                          +{items.length - shown.length} more
                        </span>
                      ) : null}
                    </span>
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
