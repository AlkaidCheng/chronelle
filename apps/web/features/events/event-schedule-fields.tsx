import type { EventScheduleDraft } from "../../lib/event-schedule";
import { CalendarDateField } from "../../components/calendar-date-field";

export function EventScheduleFields({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: EventScheduleDraft;
  readonly onChange: (change: Partial<EventScheduleDraft>) => void;
  readonly disabled?: boolean;
}) {
  return (
    <fieldset className="event-schedule-fields" disabled={disabled}>
      <legend>Schedule</legend>
      <label className="field">
        Date precision
        <select
          value={value.mode}
          onChange={(event) =>
            onChange({ mode: event.target.value as EventScheduleDraft["mode"] })
          }
        >
          <option value="unscheduled">Not decided yet</option>
          <option value="dates">Dates only</option>
          <option value="timed">Dates and times</option>
        </select>
      </label>
      {value.mode !== "unscheduled" ? (
        <>
          <div className="form-grid">
            <CalendarDateField
              label="Start date"
              value={value.startDate}
              onChange={(startDate) => onChange({ startDate })}
              disabled={disabled}
              required
            />
            <CalendarDateField
              label="End date (optional)"
              value={value.endDate}
              onChange={(endDate) => onChange({ endDate })}
              disabled={disabled}
            />
          </div>
          {value.mode === "timed" ? (
            <>
              <div className="form-grid">
                <label className="field">
                  Start time
                  <input
                    type="text"
                    placeholder="HH:mm"
                    pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
                    maxLength={5}
                    required
                    value={value.startTime}
                    onChange={(event) =>
                      onChange({ startTime: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  End time (optional)
                  <input
                    type="text"
                    placeholder="HH:mm"
                    pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
                    maxLength={5}
                    value={value.endTime}
                    onChange={(event) =>
                      onChange({ endTime: event.target.value })
                    }
                  />
                </label>
              </div>
              <p className="field-hint">
                Times use this device's timezone:{" "}
                {Intl.DateTimeFormat().resolvedOptions().timeZone}. Use 24-hour
                HH:mm.
              </p>
            </>
          ) : (
            <p className="field-hint">
              No exact time needed. The end date is included in the event.
            </p>
          )}
        </>
      ) : null}
    </fieldset>
  );
}
