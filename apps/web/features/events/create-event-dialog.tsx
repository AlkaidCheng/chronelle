import { type FormEvent, useEffect, useRef, useState } from "react";

import { ErrorNotice } from "../../components/feedback";
import {
  eventSchedulePayload,
  readEventSchedule,
} from "../../lib/event-schedule";
import { useCreateEvent } from "../../lib/queries";
import { useSessionDialog } from "../../lib/use-session-dialog";
import { EventScheduleFields } from "./event-schedule-fields";

export function CreateEventDialog({
  onCreated,
  onClose,
}: {
  readonly onCreated: (id: string) => void;
  readonly onClose: () => void;
}) {
  const createEvent = useCreateEvent();
  const [displayName, setDisplayName] = useState("");
  const [schedule, setSchedule] = useState(readEventSchedule);
  const [scheduleError, setScheduleError] = useState("");
  const dialog = useSessionDialog(onClose);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameInput.current?.focus();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createEvent.isPending) return;
    let timing: ReturnType<typeof eventSchedulePayload>;
    try {
      timing = eventSchedulePayload(schedule);
      setScheduleError("");
    } catch (error) {
      setScheduleError(
        error instanceof Error ? error.message : "Check the schedule.",
      );
      return;
    }
    createEvent.mutate(
      {
        displayName,
        ...timing,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      {
        onSuccess: (created) => {
          onClose();
          onCreated(created.id);
        },
      },
    );
  }

  return (
    <dialog
      ref={dialog}
      className="event-create-dialog"
      aria-labelledby="new-event-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!createEvent.isPending) onClose();
      }}
    >
      <header className="event-create-header">
        <h2 id="new-event-heading">Create an event</h2>
        <button
          type="button"
          className="dialog-close"
          aria-label="Close event creation"
          disabled={createEvent.isPending}
          onClick={onClose}
        >
          &#215;
        </button>
      </header>
      <form onSubmit={handleSubmit} aria-busy={createEvent.isPending}>
        <div className="event-create-body">
          <label className="field event-name-field">
            Event name
            <input
              ref={nameInput}
              maxLength={240}
              placeholder="What are you planning?"
              required
              disabled={createEvent.isPending}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <EventScheduleFields
            value={schedule}
            onChange={(change) => {
              setSchedule((current) => ({ ...current, ...change }));
              setScheduleError("");
            }}
            disabled={createEvent.isPending}
          />
          {scheduleError && <p role="alert">{scheduleError}</p>}
          {createEvent.isError && <ErrorNotice error={createEvent.error} />}
        </div>
        <footer className="event-create-footer">
          <button
            className="button button-quiet"
            type="button"
            disabled={createEvent.isPending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            type="submit"
            disabled={createEvent.isPending}
          >
            {createEvent.isPending ? "Creating..." : "Create event"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
