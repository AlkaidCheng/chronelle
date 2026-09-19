"use client";

import { useTranslations } from "next-intl";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { activeLocale } from "../i18n/active-locale";
import { selectCalendarRange } from "../lib/calendar-range";
import { type DayKey, instantDay, parseDayKey } from "../lib/day-placement";
import {
  type DueShortcut,
  dueShortcuts,
  dueWeekday,
  exactDueDay,
  parseDueText,
  repeatChoices,
} from "../lib/due-choices";
import { useDisplayPreferences } from "../lib/use-display-preferences";
import {
  ClockIcon,
  NextWeekIcon,
  RepeatIcon,
  SunIcon,
  TodayIcon,
  WeekendIcon,
} from "./icons";
import { MonthList } from "./month-list";
import { useMenuDismissal } from "./quiet-menu";

/** One moment: a calendar day and, when set, a local time of day. */
export interface DayValue {
  readonly day: string;
  readonly time: string;
}

/** A span: a start day, an optional end day, and optional local times. */
export interface SpanValue {
  readonly startDate: string;
  readonly endDate: string;
  readonly startTime: string;
  readonly endTime: string;
}

/** A repeat rule and the last day it repeats to, each the empty string for none. */
export interface RepeatValue {
  readonly rule: string;
  readonly until: string;
}

interface CommonProps {
  /** The panel's accessible name: what it sets. */
  readonly label: string;
  /** Today, for tests. */
  readonly now?: Date;
  readonly disabled?: boolean;
  /** Open with the time fields unfolded (the times row, a reminder). */
  readonly timeOpen?: boolean;
  /** The time cannot be removed (a moment that is always timed). */
  readonly timeRequired?: boolean;
  /** Closes the panel; true when a key closed it, so the opener takes focus back. */
  readonly onClose: (byKeyboard: boolean) => void;
}

interface DayProps extends CommonProps {
  readonly kind: "day";
  readonly value: DayValue;
  readonly onChange: (value: DayValue) => void;
  /** With this, the foot offers a repeat rule and its last day. */
  readonly repeat?: RepeatValue | undefined;
  readonly onRepeatChange?: ((repeat: RepeatValue) => void) | undefined;
}

interface SpanProps extends CommonProps {
  readonly kind: "span";
  readonly value: SpanValue;
  readonly onChange: (value: SpanValue) => void;
}

export type DatePanelProps = DayProps | SpanProps;

// A span typed as two dates: "to", a dash, or the Chinese "dao" or "zhi".
const spanSeparator = /\s+(?:to|-|\u2013|\u2014|\u5230|\u81f3)\s+/u;

/** A calendar day's month and day, short, in the active locale. */
const monthDayShort = (day: DayKey) =>
  new Intl.DateTimeFormat(activeLocale(), {
    month: "short",
    day: "numeric",
  }).format(parseDayKey(day));

function shortcutIcon(id: DueShortcut["id"]) {
  switch (id) {
    case "today":
      return <TodayIcon className="date-panel-shortcut-icon" />;
    case "tomorrow":
      return <SunIcon className="date-panel-shortcut-icon" />;
    case "next-week":
      return <NextWeekIcon className="date-panel-shortcut-icon" />;
    case "next-weekend":
      return <WeekendIcon className="date-panel-shortcut-icon" />;
  }
}

/** The days the panel holds, as one text: "Nov 3, 2026" or "Nov 3, 2026 to Nov 5, 2026". */
function textOf(props: DatePanelProps): string {
  if (props.kind === "day")
    return props.value.day === "" ? "" : exactDueDay(props.value.day);
  const { startDate, endDate } = props.value;
  if (startDate === "") return "";
  return endDate === "" || endDate === startDate
    ? exactDueDay(startDate)
    : `${exactDueDay(startDate)} to ${exactDueDay(endDate)}`;
}

/**
 * The panel every date field opens: a typed date at the top, four
 * shortcuts with their day, the months as one continuous list, then Time
 * (and, for a task, Repeat) at the foot, unfolding their fields in place.
 * A day press sets a single date and closes; for a span it sets the start,
 * then the end, and stays open. Escape and a press outside close it.
 */
/**
 * Keeps the panel against the viewport under (or, without room, above) the
 * row that opened it. The panel is fixed rather than absolute because the
 * editors' bodies scroll and would clip a child that ran past them; on a
 * phone the stylesheet makes it a sheet and the position is left alone.
 */
function usePanelPlacement(panel: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const element = panel.current;
    const opener = element?.parentElement;
    if (!element || !opener) return;
    const place = () => {
      if (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(max-width: 600px)").matches
      ) {
        element.style.left = "";
        element.style.top = "";
        element.style.maxHeight = "";
        return;
      }
      const gap = 4;
      const edge = 12;
      const anchor = opener.getBoundingClientRect();
      const height = element.offsetHeight;
      const below = window.innerHeight - anchor.bottom - gap - edge;
      const above = anchor.top - gap - edge;
      const up = height > below && above > below;
      const room = Math.max(160, up ? above : below);
      element.style.maxHeight = `${room}px`;
      const shown = Math.min(height, room);
      const top = up ? anchor.top - gap - shown : anchor.bottom + gap;
      const left = Math.min(
        Math.max(edge, anchor.left),
        window.innerWidth - element.offsetWidth - edge,
      );
      element.style.top = `${Math.max(edge, top)}px`;
      element.style.left = `${left}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [panel]);
}

export function DatePanel(props: DatePanelProps) {
  const {
    label,
    now = new Date(),
    disabled = false,
    timeOpen = false,
    timeRequired = false,
    onClose,
  } = props;
  const t = useTranslations("datePanel");
  const id = useId();
  const { timeZone } = useDisplayPreferences();
  const panel = useRef<HTMLDivElement>(null);
  const typed = useRef<HTMLInputElement>(null);
  const today = instantDay(now);
  const hasTime =
    props.kind === "day"
      ? props.value.time !== ""
      : props.value.startTime !== "" || props.value.endTime !== "";
  const [timeOn, setTimeOn] = useState(timeOpen || timeRequired || hasTime);
  const [repeatOn, setRepeatOn] = useState(
    props.kind === "day" && (props.repeat?.rule ?? "") !== "",
  );
  const [text, setText] = useState(() => textOf(props));
  const [mirrored, setMirrored] = useState(() => textOf(props));
  const [untilText, setUntilText] = useState(() =>
    props.kind === "day" && props.repeat !== undefined && props.repeat.until
      ? exactDueDay(props.repeat.until)
      : "",
  );
  const [untilMirrored, setUntilMirrored] = useState(
    props.kind === "day" ? (props.repeat?.until ?? "") : "",
  );
  // The next day chosen on the grid ends a span while a start stands alone.
  const [selectingEnd, setSelectingEnd] = useState(
    props.kind === "span" &&
      props.value.startDate !== "" &&
      props.value.endDate === "",
  );
  const chosenDay =
    props.kind === "day" ? props.value.day : props.value.startDate;
  const [reveal, setReveal] = useState<DayKey>(chosenDay || today);

  // The text follows a choice made elsewhere; typed text stands on its own.
  const current = textOf(props);
  if (current !== mirrored) {
    setMirrored(current);
    setText(current);
  }
  const until = props.kind === "day" ? (props.repeat?.until ?? "") : "";
  if (until !== untilMirrored) {
    setUntilMirrored(until);
    setUntilText(until === "" ? "" : exactDueDay(until));
  }

  usePanelPlacement(panel);
  const contains = useCallback(
    (target: Node) =>
      panel.current?.contains(target) === true ||
      panel.current?.parentElement?.contains(target) === true,
    [],
  );
  useMenuDismissal(true, contains, onClose);
  useEffect(() => {
    typed.current?.focus();
  }, []);

  const parseTyped = (
    value: string,
  ): { readonly start: string; readonly end: string } | null | "" => {
    if (value.trim() === "") return "";
    if (props.kind === "day") {
      const day = parseDueText(value, now);
      return day === null ? null : { start: day, end: "" };
    }
    const [first, second] = value.split(spanSeparator);
    const start = parseDueText(first ?? "", now);
    if (start === null) return null;
    if (second === undefined) return { start, end: "" };
    const end = parseDueText(second, now);
    return end === null ? null : { start, end };
  };
  const parsed = parseTyped(text);
  const unreadable = parsed === null;
  const endBeforeStart =
    parsed !== null &&
    parsed !== "" &&
    parsed.end !== "" &&
    parsed.end < parsed.start;

  const setDays = (start: string, end: string) => {
    if (props.kind === "day") {
      props.onChange({
        day: start,
        time: start === "" ? "" : props.value.time,
      });
      return;
    }
    props.onChange({
      startDate: start,
      endDate: end,
      startTime: start === "" ? "" : props.value.startTime,
      endTime: start === "" || end === "" ? "" : props.value.endTime,
    });
  };
  const readText = (value: string) => {
    setText(value);
    const read = parseTyped(value);
    if (read === null) return;
    if (read === "") {
      setMirrored("");
      setDays("", "");
      return;
    }
    if (read.end !== "" && read.end < read.start) return;
    setSelectingEnd(props.kind === "span" && read.end === "");
    setReveal(read.start);
    setDays(read.start, read.end);
  };
  const onTypedKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (unreadable || endBeforeStart) return;
    onClose(true);
  };
  const chooseShortcut = (shortcut: DueShortcut) => {
    const end = props.kind === "span" ? (shortcut.through ?? "") : "";
    setSelectingEnd(false);
    setReveal(shortcut.day);
    setDays(shortcut.day, end);
    onClose(true);
  };
  const chooseDay = (day: DayKey) => {
    setReveal(day);
    if (props.kind === "day") {
      setDays(day, "");
      onClose(true);
      return;
    }
    const range = selectCalendarRange(props.value, day, selectingEnd);
    setSelectingEnd(range.endDate === "");
    setDays(range.startDate, range.endDate);
  };
  const chooseSpan = (from: DayKey, to: DayKey) => {
    setSelectingEnd(false);
    setReveal(from);
    setDays(from, from === to ? "" : to);
  };
  const shortcutPressed = (shortcut: DueShortcut) =>
    props.kind === "day"
      ? props.value.day === shortcut.day
      : props.value.startDate === shortcut.day &&
        props.value.endDate === (shortcut.through ?? "");
  const marks = (day: DayKey) =>
    props.kind === "day"
      ? { pressed: day === props.value.day }
      : {
          pressed: day === props.value.startDate || day === props.value.endDate,
          between:
            props.value.endDate !== "" &&
            day > props.value.startDate &&
            day < props.value.endDate,
        };

  const untilParsed =
    untilText.trim() === "" ? "" : parseDueText(untilText, now);
  const untilUnreadable = untilParsed === null;
  const untilEarly =
    typeof untilParsed === "string" &&
    untilParsed !== "" &&
    chosenDay !== "" &&
    untilParsed < chosenDay;
  const readUntil = (value: string) => {
    if (props.kind !== "day" || props.onRepeatChange === undefined) return;
    setUntilText(value);
    if (value.trim() === "") {
      setUntilMirrored("");
      props.onRepeatChange({ rule: props.repeat?.rule ?? "", until: "" });
      return;
    }
    const day = parseDueText(value, now);
    if (day === null || (chosenDay !== "" && day < chosenDay)) return;
    setUntilMirrored(day);
    props.onRepeatChange({ rule: props.repeat?.rule ?? "", until: day });
  };

  const zone = (
    timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  ).replaceAll("_", " ");
  const timeFields =
    props.kind === "day" ? (
      <div className="date-panel-times">
        <label className="date-panel-time">
          <span className="date-panel-time-label">{t("time")}</span>
          <input
            disabled={disabled || props.value.day === ""}
            onChange={(input) =>
              props.onChange({ ...props.value, time: input.target.value })
            }
            className="date-panel-field"
            type="time"
            value={props.value.time}
          />
        </label>
        {timeRequired ? null : (
          <button
            className="button button-quiet button-small"
            disabled={disabled}
            onClick={() => {
              setTimeOn(false);
              props.onChange({ ...props.value, time: "" });
            }}
            type="button"
          >
            {t("removeTime")}
          </button>
        )}
      </div>
    ) : (
      <div className="date-panel-times">
        <label className="date-panel-time">
          <span className="date-panel-time-label">{t("startTime")}</span>
          <input
            disabled={disabled || props.value.startDate === ""}
            onChange={(input) =>
              props.onChange({ ...props.value, startTime: input.target.value })
            }
            className="date-panel-field"
            type="time"
            value={props.value.startTime}
          />
        </label>
        <label className="date-panel-time">
          <span className="date-panel-time-label">{t("endTime")}</span>
          <input
            disabled={disabled || props.value.startDate === ""}
            onChange={(input) =>
              props.onChange({
                ...props.value,
                endTime: input.target.value,
                // An end time on one day is that day's end.
                endDate:
                  input.target.value === "" &&
                  props.value.endDate === props.value.startDate
                    ? ""
                    : props.value.endDate || props.value.startDate,
              })
            }
            className="date-panel-field"
            type="time"
            value={props.value.endTime}
          />
        </label>
        {timeRequired ? null : (
          <button
            className="button button-quiet button-small"
            disabled={disabled}
            onClick={() => {
              setTimeOn(false);
              props.onChange({ ...props.value, startTime: "", endTime: "" });
            }}
            type="button"
          >
            {t("removeTimes")}
          </button>
        )}
      </div>
    );

  return (
    <div aria-label={label} className="date-panel" ref={panel} role="dialog">
      <input
        aria-describedby={
          unreadable || endBeforeStart ? `${id}-hint` : undefined
        }
        aria-invalid={unreadable || endBeforeStart}
        aria-label={t("typeDate")}
        className="date-panel-typed"
        disabled={disabled}
        onBlur={() => {
          if (!unreadable && !endBeforeStart) setText(textOf(props));
        }}
        onChange={(input) => readText(input.target.value)}
        onKeyDown={onTypedKey}
        placeholder={
          props.kind === "day" ? t("placeholder") : t("spanPlaceholder")
        }
        ref={typed}
        type="text"
        value={text}
      />
      {unreadable || endBeforeStart ? (
        <p className="date-panel-hint" id={`${id}-hint`}>
          {unreadable ? t("unreadable") : t("endBeforeStart")}
        </p>
      ) : null}
      <ul aria-label={t("shortcuts")} className="date-panel-shortcuts">
        {dueShortcuts(now).map((shortcut) => (
          <li key={shortcut.id}>
            <button
              aria-pressed={shortcutPressed(shortcut)}
              disabled={disabled}
              onClick={() => chooseShortcut(shortcut)}
              type="button"
            >
              {shortcutIcon(shortcut.id)}
              <span>{shortcut.label}</span>
              <span className="date-panel-shortcut-day">
                {shortcut.id === "today" || shortcut.id === "tomorrow"
                  ? dueWeekday(shortcut.day)
                  : `${dueWeekday(shortcut.day)} ${monthDayShort(shortcut.day)}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="date-panel-months">
        <MonthList
          anchor={chosenDay || today}
          disabled={disabled}
          marks={marks}
          now={now}
          onChooseDay={chooseDay}
          {...(props.kind === "span" && { onChooseSpan: chooseSpan })}
          reveal={reveal}
        />
      </div>
      <div className="date-panel-foot">
        {timeOn ? (
          timeFields
        ) : (
          <button
            className="date-panel-line"
            disabled={disabled || chosenDay === ""}
            onClick={() => setTimeOn(true)}
            type="button"
          >
            <ClockIcon className="date-panel-line-icon" />
            <span>{props.kind === "day" ? t("time") : t("times")}</span>
          </button>
        )}
        {timeOn ? (
          <p className="date-panel-hint">{t("timesIn", { zone })}</p>
        ) : null}
        {props.kind === "day" && props.onRepeatChange !== undefined ? (
          repeatOn ? (
            <div className="date-panel-repeat">
              <label className="date-panel-time">
                <span className="date-panel-time-label" id={`${id}-repeat`}>
                  {t("repeat")}
                </span>
                <select
                  aria-labelledby={`${id}-repeat`}
                  className="date-panel-field"
                  disabled={disabled || props.value.day === ""}
                  onChange={(input) =>
                    props.onRepeatChange?.({
                      rule: input.target.value,
                      until: input.target.value === "" ? "" : until,
                    })
                  }
                  value={props.repeat?.rule ?? ""}
                >
                  <option value="">{t("noRepeat")}</option>
                  {repeatChoices().map(([rule, name]) => (
                    <option key={rule} value={rule}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              {(props.repeat?.rule ?? "") !== "" ? (
                <label className="date-panel-time">
                  <span className="date-panel-time-label">{t("until")}</span>
                  <input
                    aria-describedby={
                      untilUnreadable || untilEarly ? `${id}-until` : undefined
                    }
                    aria-invalid={untilUnreadable || untilEarly}
                    disabled={disabled}
                    onBlur={() => {
                      if (!untilUnreadable && !untilEarly)
                        setUntilText(until === "" ? "" : exactDueDay(until));
                    }}
                    onChange={(input) => readUntil(input.target.value)}
                    placeholder={t("optional")}
                    className="date-panel-field"
                    type="text"
                    value={untilText}
                  />
                </label>
              ) : null}
              {untilUnreadable || untilEarly ? (
                <p className="date-panel-hint" id={`${id}-until`}>
                  {untilUnreadable ? t("untilUnreadable") : t("untilEarly")}
                </p>
              ) : null}
            </div>
          ) : (
            <button
              className="date-panel-line"
              disabled={disabled || props.value.day === ""}
              onClick={() => setRepeatOn(true)}
              type="button"
            >
              <RepeatIcon className="date-panel-line-icon" />
              <span>{t("repeat")}</span>
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}
