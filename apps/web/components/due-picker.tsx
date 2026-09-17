"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { activeLocale, tr } from "../i18n/active-locale";
import {
  type DayKey,
  addDays,
  dayKeyOf,
  instantDate,
  instantDay,
  parseDayKey,
} from "../lib/day-placement";
import {
  describeDueDay,
  describeRepeat,
  dueShortcuts,
  dueWeekday,
  exactDueDay,
  parseDueText,
  repeatChoices,
} from "../lib/due-choices";
import { formatDuration, formatTime, fromDateTimeInput } from "../lib/format";
import { useDisplayPreferences } from "../lib/use-display-preferences";
import { MonthList } from "./month-list";

/** A calendar day's month and day, short, in the active locale. */
const monthDayShort = (day: DayKey) =>
  new Intl.DateTimeFormat(activeLocale(), {
    month: "short",
    day: "numeric",
  }).format(parseDayKey(day));
const weekdayLong = (day: DayKey) =>
  new Intl.DateTimeFormat(activeLocale(), { weekday: "long" }).format(
    parseDayKey(day),
  );

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
  if (dueDate === "") return tr("dueField")("noDate");
  const day = describeDueDay(dueDate, now);
  const time =
    dueTime === ""
      ? day
      : `${day}, ${formatTime(fromDateTimeInput(`${dueDate}T${dueTime}`) ?? "")}`;
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
  const t = useTranslations("dueField");
  const id = useId();
  const { timeZone } = useDisplayPreferences();
  const today = instantDay(now);
  const tomorrow = dayKeyOf(addDays(instantDate(now), 1));
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
        {t("summary", {
          due: describeDue(
            dueDate,
            dueTime,
            duration,
            now,
            repeat,
            repeatUntil,
          ),
        })}
      </summary>
      {open ? (
        <div className="due-panel">
          <label className="field">
            <span>{t("dueDate")}</span>
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
              placeholder={t("placeholder")}
              type="text"
              value={text}
            />
          </label>
          {unreadable || dueDate !== "" ? (
            <p className="field-hint" id={`${id}-date-hint`}>
              {unreadable
                ? t("unreadable")
                : t("dueOn", {
                    weekday: weekdayLong(dueDate),
                    relative:
                      dueDate === today
                        ? "today"
                        : dueDate === tomorrow
                          ? "tomorrow"
                          : "other",
                  })}
            </p>
          ) : null}
          <ul aria-label={t("shortcuts")} className="day-shortcuts">
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
                      ? `${dueWeekday(shortcut.day)} ${monthDayShort(shortcut.day)}`
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
                <span>{t("noDate")}</span>
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
              {showTime ? t("removeTime") : t("addTime")}
            </button>
            {showTime ? (
              <div className="due-time-fields">
                <label className="field">
                  <span>{t("dueTime")}</span>
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
                  <span id={`${id}-duration`}>{t("duration")}</span>
                  <select
                    aria-labelledby={`${id}-duration`}
                    disabled={disabled || dueTime === ""}
                    onChange={(input) =>
                      change({ duration: input.target.value })
                    }
                    value={duration}
                  >
                    <option value="">{t("noDuration")}</option>
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
                {t("timesIn", {
                  zone: (
                    timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
                  ).replaceAll("_", " "),
                })}
              </p>
            ) : null}
          </div>
          <div className="due-repeat">
            <label className="field">
              <span id={`${id}-repeat`}>{t("repeat")}</span>
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
                <option value="">{t("noRepeat")}</option>
                {repeatChoices().map(([rule, label]) => (
                  <option key={rule} value={rule}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {repeat !== "" ? (
              <label className="field">
                <span>{t("until")}</span>
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
                  placeholder={t("optional")}
                  type="text"
                  value={untilText}
                />
              </label>
            ) : null}
            {untilUnreadable || untilEarly ? (
              <p className="field-hint" id={`${id}-until-hint`}>
                {untilUnreadable ? t("untilUnreadable") : t("untilEarly")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </details>
  );
}
