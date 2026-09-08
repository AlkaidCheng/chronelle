import { calendarDateSchema } from "@chronelle/schemas";
import { useEffect, useId, useRef, useState } from "react";

import {
  type CalendarRange,
  calendarMonthDate,
  selectCalendarRange,
  shiftCalendarDate,
} from "../lib/calendar-range";
import { formatCalendarDate } from "../lib/event-schedule";
import { toDateTimeInput } from "../lib/format";

const monthFormatter = new Intl.DateTimeFormat(undefined, {
  month: "long",
  timeZone: "UTC",
});
const weekdayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  timeZone: "UTC",
});
const months = Array.from({ length: 12 }, (_, index) =>
  monthFormatter.format(new Date(calendarMonthDate(2000, index + 1))),
);
const weekdays = Array.from({ length: 7 }, (_, day) =>
  weekdayFormatter.format(new Date(Date.UTC(2026, 0, 4 + day))),
);

export function CalendarRangePicker({
  value,
  onChange,
}: {
  readonly value: CalendarRange;
  readonly onChange: (range: CalendarRange) => void;
}) {
  const today = toDateTimeInput(new Date().toISOString()).slice(0, 10);
  const [focused, setFocused] = useState(value.startDate || today);
  const [selectingEnd, setSelectingEnd] = useState(
    Boolean(value.startDate && !value.endDate),
  );
  const [hovered, setHovered] = useState("");
  const [view, setView] = useState<"days" | "months" | "years">("days");
  const [expanded, setExpanded] = useState(!value.startDate);
  const [yearPage, setYearPage] = useState(Number(focused.slice(0, 4)));
  const grid = useRef<HTMLTableElement>(null);
  const calendar = useRef<HTMLDivElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const hintId = useId();
  const year = Number(focused.slice(0, 4));
  const month = Number(focused.slice(5, 7));
  const first = calendarMonthDate(year, month);
  const firstWeekday = new Date(first).getUTCDay();
  const rangeEnd =
    value.endDate ||
    (selectingEnd && hovered >= value.startDate ? hovered : "");

  useEffect(() => {
    if (expanded) calendar.current?.scrollIntoView({ block: "start" });
  }, [expanded]);

  function navigate(date: string, focusGrid = false) {
    if (!calendarDateSchema.safeParse(date).success) return;
    setFocused(date);
    setHovered("");
    if (focusGrid)
      requestAnimationFrame(() =>
        grid.current
          ?.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)
          ?.focus(),
      );
  }

  function showDays(date: string) {
    setExpanded(true);
    setView("days");
    navigate(date, true);
  }

  function move(direction: number) {
    if (view === "years") {
      setYearPage((current) =>
        Math.max(1, Math.min(9988, current + direction * 12)),
      );
      return;
    }
    const date = new Date(first);
    date.setUTCMonth(
      date.getUTCMonth() + direction * (view === "months" ? 12 : 1),
    );
    navigate(date.toISOString().slice(0, 10));
  }

  function choose(date: string) {
    const next = selectCalendarRange(value, date, selectingEnd);
    onChange(next);
    setSelectingEnd(!next.endDate);
    navigate(date, true);
  }

  const unit =
    view === "years" ? "12 years" : view === "months" ? "year" : "month";
  return (
    <div className="calendar-range" ref={calendar}>
      <div className="calendar-range-summary">
        <button
          ref={startButton}
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-pressed={expanded && !selectingEnd}
          aria-label={`Start date: ${value.startDate ? formatCalendarDate(value.startDate) : "Choose a day"}`}
          onClick={() => {
            setSelectingEnd(false);
            showDays(value.startDate || focused);
          }}
        >
          <span>Starts</span>
          <strong>
            {value.startDate
              ? formatCalendarDate(value.startDate)
              : "Choose a day"}
          </strong>
        </button>
        <span aria-hidden="true">&rarr;</span>
        <button
          type="button"
          disabled={!value.startDate}
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-pressed={expanded && selectingEnd}
          aria-label={`End date: ${value.endDate ? formatCalendarDate(value.endDate) : "Optional"}`}
          onClick={() => {
            setSelectingEnd(true);
            showDays(value.endDate || value.startDate);
          }}
        >
          <span>Ends</span>
          <strong>
            {value.endDate ? formatCalendarDate(value.endDate) : "Optional"}
          </strong>
        </button>
      </div>
      {expanded ? (
        <>
          <div className="calendar-navigation">
            <button
              type="button"
              className="calendar-step"
              aria-label={`Previous ${unit}`}
              disabled={
                view === "years"
                  ? yearPage === 1
                  : year === 1 && (view === "months" || month === 1)
              }
              onClick={() => move(-1)}
            >
              &lsaquo;
            </button>
            <div className="calendar-heading">
              <button
                type="button"
                aria-label="Change month"
                aria-expanded={view === "months"}
                aria-controls={panelId}
                onClick={() => setView(view === "months" ? "days" : "months")}
              >
                {months[month - 1]} <span aria-hidden="true">&#8964;</span>
              </button>
              <button
                type="button"
                aria-label="Change year"
                aria-expanded={view === "years"}
                aria-controls={panelId}
                onClick={() => {
                  setYearPage(
                    Math.max(1, Math.min(9988, Math.floor(year / 10) * 10)),
                  );
                  setView(view === "years" ? "days" : "years");
                }}
              >
                {year} <span aria-hidden="true">&#8964;</span>
              </button>
            </div>
            <button
              type="button"
              className="calendar-step"
              aria-label={`Next ${unit}`}
              disabled={
                view === "years"
                  ? yearPage === 9988
                  : year === 9999 && (view === "months" || month === 12)
              }
              onClick={() => move(1)}
            >
              &rsaquo;
            </button>
          </div>
          <div id={panelId} className="calendar-panel">
            {view === "days" ? (
              <table
                ref={grid}
                className="calendar-grid"
                // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: The calendar uses a roving tabindex and arrow-key grid navigation.
                role="grid"
                aria-label={`${months[month - 1]} ${year}`}
                aria-describedby={hintId}
                onPointerLeave={() => setHovered("")}
              >
                <thead>
                  <tr>
                    {weekdays.map((weekday) => {
                      return (
                        <th key={weekday} scope="col" abbr={weekday}>
                          {weekday.slice(0, 1)}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 6 }, (_, row) => (
                    <tr key={shiftCalendarDate(first, row * 7 - firstWeekday)}>
                      {Array.from({ length: 7 }, (_, column) => {
                        const date = shiftCalendarDate(
                          first,
                          row * 7 + column - firstWeekday,
                        );
                        const valid =
                          calendarDateSchema.safeParse(date).success;
                        const selected =
                          date === value.startDate || date === value.endDate;
                        return (
                          <td
                            key={date}
                            data-in-range={Boolean(
                              value.startDate &&
                              rangeEnd &&
                              date >= value.startDate &&
                              date <= rangeEnd,
                            )}
                            data-range-start={date === value.startDate}
                            data-range-end={date === rangeEnd}
                          >
                            <button
                              type="button"
                              disabled={!valid}
                              data-date={date}
                              data-outside-month={
                                date.slice(0, 7) !== first.slice(0, 7)
                              }
                              tabIndex={date === focused ? 0 : -1}
                              aria-label={
                                valid
                                  ? formatCalendarDate(date)
                                  : "Unavailable date"
                              }
                              aria-pressed={selected}
                              aria-current={date === today ? "date" : undefined}
                              onPointerEnter={() => setHovered(date)}
                              onClick={() => choose(date)}
                              onKeyDown={(event) => {
                                const offsets: Record<string, number> = {
                                  ArrowLeft: -1,
                                  ArrowRight: 1,
                                  ArrowUp: -7,
                                  ArrowDown: 7,
                                  Home: -column,
                                  End: 6 - column,
                                };
                                const offset = offsets[event.key];
                                if (offset !== undefined) {
                                  event.preventDefault();
                                  navigate(
                                    shiftCalendarDate(date, offset),
                                    true,
                                  );
                                }
                              }}
                            >
                              {valid ? Number(date.slice(8)) : ""}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <fieldset
                className="calendar-choices"
                aria-label={
                  view === "months"
                    ? `Months in ${year}`
                    : `Years ${yearPage} to ${yearPage + 11}`
                }
              >
                {Array.from({ length: 12 }, (_, index) => {
                  const choice =
                    view === "months" ? index + 1 : yearPage + index;
                  return (
                    <button
                      type="button"
                      key={choice}
                      aria-pressed={
                        choice === (view === "months" ? month : year)
                      }
                      onClick={() =>
                        showDays(
                          view === "months"
                            ? calendarMonthDate(year, choice)
                            : calendarMonthDate(choice, month),
                        )
                      }
                    >
                      {view === "months" ? months[choice - 1] : choice}
                    </button>
                  );
                })}
              </fieldset>
            )}
          </div>
          <div className="calendar-footer">
            <button type="button" onClick={() => showDays(today)}>
              Today
            </button>
            <button
              type="button"
              disabled={!value.startDate}
              onClick={() => {
                onChange({ startDate: "", endDate: "" });
                setSelectingEnd(false);
                setHovered("");
              }}
            >
              Clear dates
            </button>
            <button
              type="button"
              disabled={!value.startDate}
              onClick={() => {
                setExpanded(false);
                startButton.current?.focus();
              }}
            >
              Done
            </button>
          </div>
          <p
            className="field-hint calendar-hint"
            id={hintId}
            aria-live="polite"
          >
            {!value.startDate
              ? "Choose a start date."
              : selectingEnd
                ? "Select another day for an end date."
                : "Select a day to start a new range."}
          </p>
        </>
      ) : null}
    </div>
  );
}
