import { formatCalendarDate } from "./event-schedule";

export interface CalendarRange {
  readonly startDate: string;
  readonly endDate: string;
}

/** The range as its exact dates: not set, one day, or a start and an end. */
export function describeCalendarRange(range: CalendarRange): string {
  if (!range.startDate) return "not set";
  if (!range.endDate || range.endDate === range.startDate)
    return formatCalendarDate(range.startDate);
  return `${formatCalendarDate(range.startDate)} to ${formatCalendarDate(range.endDate)}`;
}

export function calendarMonthDate(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

export function shiftCalendarDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Move by whole months, clamping the day to the target month's last day. */
export function shiftCalendarMonth(value: string, months: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return value;
  const last = new Date(date);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, last.getUTCDate()));
  return date.toISOString().slice(0, 10);
}

export function selectCalendarRange(
  range: CalendarRange,
  date: string,
  selectingEnd: boolean,
): CalendarRange {
  if (selectingEnd && range.startDate && date >= range.startDate)
    return { startDate: range.startDate, endDate: date };
  return { startDate: date, endDate: "" };
}
