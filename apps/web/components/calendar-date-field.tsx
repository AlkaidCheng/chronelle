"use client";

import { calendarDateSchema } from "@chronelle/schemas";
import { useEffect, useId, useRef, useState } from "react";
import { useSessionDialog } from "../lib/use-session-dialog";

const months = Array.from({ length: 12 }, (_, index) => index + 1);
const weekdays = [0, 1, 2, 3, 4, 5, 6];
const weekOffsets = [0, 7, 14, 21, 28, 35];

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function DateChooser({
  value,
  onChange,
  onClose,
  label,
}: {
  readonly value: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly onClose: () => void;
}) {
  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [focused, setFocused] = useState(
    calendarDateSchema.safeParse(value).success ? value : localToday,
  );
  const year = Number(focused.slice(0, 4));
  const month = Number(focused.slice(5, 7));
  const [yearInput, setYearInput] = useState(String(year));
  const dialog = useSessionDialog(onClose);
  const headingId = useId();
  const grid = useRef<HTMLTableElement>(null);
  useEffect(() => {
    grid.current
      ?.querySelector<HTMLButtonElement>('button[tabindex="0"]')
      ?.focus();
  }, []);
  const first = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const firstDay = new Date(`${first}T00:00:00Z`).getUTCDay();
  const monthName = (monthIndex: number) =>
    new Intl.DateTimeFormat(undefined, {
      month: "long",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2000, monthIndex, 1)));
  function navigate(value: string, focusGrid = false) {
    if (!calendarDateSchema.safeParse(value).success) return;
    setFocused(value);
    setYearInput(value.slice(0, 4));
    if (focusGrid)
      requestAnimationFrame(() =>
        grid.current
          ?.querySelector<HTMLButtonElement>(`button[data-date="${value}"]`)
          ?.focus(),
      );
  }
  function moveMonth(delta: number) {
    const date = new Date(`${first}T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + delta);
    if (date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999)
      navigate(date.toISOString().slice(0, 10));
  }
  return (
    <dialog
      ref={dialog}
      className="date-chooser"
      aria-labelledby={headingId}
      onCancel={onClose}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          navigate(focused, true);
        }
      }}
    >
      <div className="section-title-row">
        <h2 id={headingId}>{label}</h2>
        <button type="button" onClick={onClose} aria-label="Close date picker">
          Close
        </button>
      </div>
      <div className="date-chooser-navigation">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => moveMonth(-1)}
        >
          &lt;
        </button>
        <label>
          Month
          <select
            value={month}
            onChange={(event) =>
              navigate(
                `${String(year).padStart(4, "0")}-${event.target.value.padStart(2, "0")}-01`,
              )
            }
          >
            {months.map((number) => (
              <option key={number} value={number}>
                {monthName(number - 1)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Year
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={9999}
            value={yearInput}
            onChange={(event) => {
              setYearInput(event.target.value);
              const next = Number(event.target.value);
              if (Number.isInteger(next) && next >= 1 && next <= 9999)
                setFocused(
                  `${String(next).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`,
                );
            }}
            onBlur={() => setYearInput(String(year))}
          />
        </label>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => moveMonth(1)}
        >
          &gt;
        </button>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {monthName(month - 1)} {year}
      </p>
      <table
        ref={grid}
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: This date-picker grid uses roving button focus inside semantic table cells.
        role="grid"
        aria-label="Choose a day"
        className="date-chooser-grid"
      >
        <thead>
          <tr>
            {weekdays.map((day) => (
              <th scope="col" key={day}>
                {new Intl.DateTimeFormat(undefined, {
                  weekday: "short",
                  timeZone: "UTC",
                }).format(new Date(Date.UTC(2026, 0, 4 + day)))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weekOffsets.map((offset) => (
            <tr key={offset}>
              {weekdays.map((weekday) => {
                const date = shiftDate(first, offset + weekday - firstDay);
                const inMonth = date.slice(0, 7) === first.slice(0, 7);
                return (
                  <td key={date}>
                    {inMonth ? (
                      <button
                        type="button"
                        data-date={date}
                        tabIndex={date === focused ? 0 : -1}
                        aria-label={date}
                        aria-pressed={date === value}
                        onClick={() => {
                          onChange(date);
                          onClose();
                        }}
                        onKeyDown={(event) => {
                          const delta = {
                            ArrowLeft: -1,
                            ArrowRight: 1,
                            ArrowUp: -7,
                            ArrowDown: 7,
                            Home: -weekday,
                            End: 6 - weekday,
                          }[event.key];
                          if (delta !== undefined) {
                            event.preventDefault();
                            navigate(shiftDate(date, delta), true);
                          }
                        }}
                      >
                        {Number(date.slice(-2))}
                      </button>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => navigate(localToday, true)}>
        Today
      </button>
    </dialog>
  );
}

export function CalendarDateField({
  label,
  value,
  onChange,
  disabled = false,
  required = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.setCustomValidity(
      value === "" || calendarDateSchema.safeParse(value).success
        ? ""
        : "Enter a valid date as YYYY-MM-DD.",
    );
  }, [value]);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="calendar-date-input">
        <input
          ref={input}
          id={id}
          type="text"
          placeholder="YYYY-MM-DD"
          pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
          maxLength={10}
          value={value}
          disabled={disabled}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          disabled={disabled}
          aria-label={`Choose ${label.toLowerCase()}`}
          onClick={() => setOpen(true)}
        >
          Choose
        </button>
      </div>
      {open && !disabled ? (
        <DateChooser
          label={label}
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
