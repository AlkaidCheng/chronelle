"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { DatePanel, type SpanValue } from "../../components/date-panel";
import { FieldRow } from "../../components/field-row";
import { CalendarIcon, ClockIcon, PinIcon } from "../../components/icons";
import { describeCalendarRange } from "../../lib/calendar-range";
import type { EventScheduleDraft } from "../../lib/event-schedule";
import { formatTime, fromDateTimeInput } from "../../lib/format";
import { locationLimit } from "../../lib/location-field";

/** The schedule's mode from what is set: no dates, dates, or dates with times. */
export function scheduleChange(value: SpanValue): EventScheduleDraft {
  return {
    mode:
      value.startDate === ""
        ? "unscheduled"
        : value.startTime === ""
          ? "dates"
          : "timed",
    startDate: value.startDate,
    endDate: value.endDate,
    startTime: value.startTime,
    endTime: value.startTime === "" ? "" : value.endTime,
  };
}

/** The times as the row reads them: "09:30" or "09:30 to 11:30" in the locale's clock. */
function describeTimes(value: EventScheduleDraft): string {
  if (value.mode !== "timed" || value.startTime === "") return "";
  const at = (day: string, time: string) =>
    formatTime(fromDateTimeInput(`${day}T${time}`) ?? "");
  const start = at(value.startDate, value.startTime);
  if (value.endTime === "") return start;
  return `${start} to ${at(value.endDate || value.startDate, value.endTime)}`;
}

/**
 * A schedule as three rows, each with its symbol: the dates, the times,
 * and the place. A row reads its value, or what it is for while unset,
 * with a clear once set. The dates and times rows open the date panel on
 * that part; the place row edits its text in place.
 */
export function ScheduleRows({
  disabled = false,
  now = new Date(),
  onChange,
  place,
  value,
}: {
  readonly disabled?: boolean;
  /** Today, for tests. */
  readonly now?: Date;
  readonly onChange: (change: Partial<EventScheduleDraft>) => void;
  /** The place row, when the editor carries one. */
  readonly place?:
    | { readonly value: string; readonly onChange: (place: string) => void }
    | undefined;
  readonly value: EventScheduleDraft;
}) {
  const t = useTranslations("scheduleFields");
  const [open, setOpen] = useState<"dates" | "times" | null>(null);
  const [placeEditing, setPlaceEditing] = useState(false);
  const datesButton = useRef<HTMLButtonElement>(null);
  const timesButton = useRef<HTMLButtonElement>(null);
  const placeButton = useRef<HTMLButtonElement>(null);
  const placeInput = useRef<HTMLInputElement>(null);
  const hasDates = value.mode !== "unscheduled" && value.startDate !== "";
  const dates = hasDates
    ? describeCalendarRange({
        startDate: value.startDate,
        endDate: value.endDate,
      })
    : "";
  const times = describeTimes(value);
  const span: SpanValue = {
    startDate: hasDates ? value.startDate : "",
    endDate: hasDates ? value.endDate : "",
    startTime: value.mode === "timed" ? value.startTime : "",
    endTime: value.mode === "timed" ? value.endTime : "",
  };
  const close = (which: "dates" | "times") => (byKeyboard: boolean) => {
    setOpen(null);
    if (byKeyboard)
      (which === "dates" ? datesButton : timesButton).current?.focus();
  };
  const panel = (which: "dates" | "times") =>
    open === which ? (
      <DatePanel
        disabled={disabled}
        kind="span"
        label={which === "dates" ? t("dates") : t("times")}
        now={now}
        onChange={(next) => onChange(scheduleChange(next))}
        onClose={close(which)}
        timeOpen={which === "times"}
        value={span}
      />
    ) : null;
  // The row's button returns once editing ends, so it takes focus after that render.
  const [placeFocus, setPlaceFocus] = useState<"input" | "button" | null>(null);
  useEffect(() => {
    if (placeFocus === "input") placeInput.current?.focus();
    else if (placeFocus === "button") placeButton.current?.focus();
    setPlaceFocus(null);
  }, [placeFocus]);
  const editPlace = () => {
    setPlaceEditing(true);
    setPlaceFocus("input");
  };
  const stopEditingPlace = (focusBack: boolean) => {
    setPlaceEditing(false);
    if (focusBack) setPlaceFocus("button");
  };
  return (
    <fieldset className="schedule-rows" disabled={disabled}>
      <legend className="visually-hidden">{t("legend")}</legend>
      <FieldRow
        buttonRef={datesButton}
        clearLabel={t("clearDates")}
        disabled={disabled}
        expanded={open === "dates"}
        hint={t("datesHint")}
        icon={<CalendarIcon className="field-row-icon" />}
        label={hasDates ? t("dates") : t("setDates")}
        onClear={() =>
          onChange(
            scheduleChange({
              startDate: "",
              endDate: "",
              startTime: "",
              endTime: "",
            }),
          )
        }
        onPress={() => setOpen(open === "dates" ? null : "dates")}
        value={dates}
      >
        {panel("dates")}
      </FieldRow>
      <FieldRow
        buttonRef={timesButton}
        clearLabel={t("clearTimes")}
        disabled={disabled}
        expanded={open === "times"}
        hint={t("allDay")}
        icon={<ClockIcon className="field-row-icon" />}
        label={times === "" ? t("setTimes") : t("times")}
        onClear={() =>
          onChange(scheduleChange({ ...span, startTime: "", endTime: "" }))
        }
        onPress={() => setOpen(open === "times" ? null : "times")}
        value={times}
      >
        {panel("times")}
      </FieldRow>
      {place === undefined ? null : placeEditing ? (
        <div className="field-row is-editing">
          <PinIcon className="field-row-icon" />
          <input
            aria-label={t("place")}
            className="field-row-input"
            disabled={disabled}
            maxLength={locationLimit}
            onBlur={() => stopEditingPlace(false)}
            onChange={(input) => place.onChange(input.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Escape") {
                event.preventDefault();
                stopEditingPlace(true);
              }
            }}
            placeholder={t("placeHint")}
            ref={placeInput}
            type="text"
            value={place.value}
          />
        </div>
      ) : (
        <FieldRow
          buttonRef={placeButton}
          clearLabel={t("clearPlace")}
          disabled={disabled}
          hint={t("placeHint")}
          icon={<PinIcon className="field-row-icon" />}
          label={place.value === "" ? t("addPlace") : t("place")}
          onClear={() => place.onChange("")}
          onPress={editPlace}
          value={place.value}
        />
      )}
    </fieldset>
  );
}
