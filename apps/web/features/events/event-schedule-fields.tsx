import { CalendarRangePicker } from "../../components/calendar-range";
import { CalendarIcon, ClockIcon } from "../../components/icons";
import type { EventScheduleDraft } from "../../lib/event-schedule";

export function EventScheduleFields({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: EventScheduleDraft;
  readonly onChange: (change: Partial<EventScheduleDraft>) => void;
  readonly disabled?: boolean;
}) {
  const hasDates = value.mode !== "unscheduled";
  const hasTimes = value.mode === "timed";
  const endTimeRequired = Boolean(
    value.endDate && value.endDate !== value.startDate,
  );
  return (
    <fieldset className="event-schedule-fields" disabled={disabled}>
      <legend className="visually-hidden">Schedule</legend>
      <label className="schedule-toggle">
        <CalendarIcon />
        <span>
          <strong>Set dates</strong>
          <small>
            {hasDates
              ? "Choose a day or date range"
              : "Leave open until you know"}
          </small>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-label="Set dates"
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
                ...(hasTimes
                  ? { endTime: range.endDate ? value.endTime || "17:00" : "" }
                  : {}),
              })
            }
          />
          <label className="schedule-toggle time-toggle">
            <ClockIcon />
            <span>
              <strong>Add times</strong>
              <small>Optional start and end times</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Add times"
              aria-checked={hasTimes}
              checked={hasTimes}
              onChange={(event) =>
                onChange({
                  mode: event.target.checked ? "timed" : "dates",
                  startTime: value.startTime || "09:00",
                  endTime: value.endDate ? value.endTime || "17:00" : "",
                })
              }
            />
            <span className="switch-track" aria-hidden="true" />
          </label>
          {hasTimes ? (
            <>
              <div className="form-grid">
                <label className="field">
                  Start time
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
                  End time{endTimeRequired ? "" : " (optional)"}
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
                Times in{" "}
                {Intl.DateTimeFormat()
                  .resolvedOptions()
                  .timeZone.replaceAll("_", " ")}
                .
              </p>
            </>
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}
