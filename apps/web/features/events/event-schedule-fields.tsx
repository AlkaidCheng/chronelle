import { useTranslations } from "next-intl";
import { CalendarRangePicker } from "../../components/calendar-range";
import { CalendarIcon, ClockIcon } from "../../components/icons";
import type { EventScheduleDraft } from "../../lib/event-schedule";
import { shownTimeZone } from "../../i18n/active-preferences";

export function EventScheduleFields({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: EventScheduleDraft;
  readonly onChange: (change: Partial<EventScheduleDraft>) => void;
  readonly disabled?: boolean;
}) {
  const t = useTranslations("scheduleFields");
  const hasDates = value.mode !== "unscheduled";
  const hasTimes = value.mode === "timed";
  const endTimeRequired = Boolean(
    value.endDate && value.endDate !== value.startDate,
  );
  return (
    <fieldset className="event-schedule-fields" disabled={disabled}>
      <legend className="visually-hidden">{t("legend")}</legend>
      <label className="schedule-toggle">
        <CalendarIcon />
        <span>
          <strong>{t("setDates")}</strong>
          <small>{hasDates ? t("datesOn") : t("datesOff")}</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-label={t("setDates")}
          aria-checked={hasDates}
          checked={hasDates}
          onChange={(event) =>
            onChange({ mode: event.target.checked ? "dates" : "unscheduled" })
          }
        />
        <span className="switch-track" aria-hidden="true" />
      </label>
      {hasDates ? (
        <>
          <CalendarRangePicker
            value={value}
            onChange={(range) =>
              onChange({
                ...range,
                endTime: range.endDate ? value.endTime : "",
              })
            }
          />
          <label className="schedule-toggle time-toggle">
            <ClockIcon />
            <span>
              <strong>{t("addTimes")}</strong>
              <small>{t("timesNote")}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label={t("addTimes")}
              aria-checked={hasTimes}
              checked={hasTimes}
              onChange={(event) =>
                onChange({
                  mode: event.target.checked ? "timed" : "dates",
                })
              }
            />
            <span className="switch-track" aria-hidden="true" />
          </label>
          {hasTimes ? (
            <>
              <div className="form-grid">
                <label className="field">
                  {t("startTime")}
                  <input
                    type="time"
                    required
                    value={value.startTime}
                    onChange={(event) =>
                      onChange({ startTime: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  {endTimeRequired ? t("endTime") : t("endTimeOptional")}
                  <input
                    type="time"
                    required={endTimeRequired}
                    value={value.endTime}
                    onChange={(event) =>
                      onChange({
                        endTime: event.target.value,
                        endDate: event.target.value
                          ? value.endDate || value.startDate
                          : endTimeRequired
                            ? value.endDate
                            : "",
                      })
                    }
                  />
                </label>
              </div>
              <p className="field-hint">
                {t("timesIn", { zone: shownTimeZone().replaceAll("_", " ") })}
              </p>
            </>
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}
