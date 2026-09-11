import { type FormEvent, useEffect, useRef, useState } from "react";

import { ErrorNotice } from "../../components/feedback";
import { EditorForm, EditorSubmitButton } from "../../components/editor-form";
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
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const dialog = useSessionDialog(onClose);
  const nameInput = useRef<HTMLInputElement>(null);
  const keepEditingButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const isDirty =
    displayName !== "" ||
    schedule.mode !== "unscheduled" ||
    [
      schedule.startDate,
      schedule.endDate,
      schedule.startTime,
      schedule.endTime,
    ].some(Boolean);
  useEffect(() => {
    nameInput.current?.focus();
  }, []);

  useEffect(() => {
    if (confirmingDiscard) keepEditingButton.current?.focus();
    else if (returnFocus.current?.isConnected) returnFocus.current.focus();
  }, [confirmingDiscard]);

  useEffect(() => {
    if (!isDirty && !createEvent.isPending) return;
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isDirty, createEvent.isPending]);

  function requestClose() {
    if (createEvent.isPending) return;
    if (confirmingDiscard) {
      setConfirmingDiscard(false);
    } else if (isDirty) {
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : nameInput.current;
      setConfirmingDiscard(true);
    } else {
      onClose();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createEvent.isPending || confirmingDiscard) return;
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
        requestClose();
      }}
    >
      <header className="event-create-header">
        <h2 id="new-event-heading">
          {confirmingDiscard ? "Discard this event?" : "Create an event"}
        </h2>
        <button
          hidden={confirmingDiscard}
          type="button"
          className="dialog-close"
          aria-label="Close event creation"
          disabled={createEvent.isPending}
          onClick={requestClose}
        >
          &#215;
        </button>
      </header>
      {confirmingDiscard && (
        <>
          <div className="event-create-body">
            <p>Your event name and schedule have not been saved.</p>
          </div>
          <footer className="event-create-footer">
            <button
              className="button button-quiet"
              type="button"
              onClick={onClose}
            >
              Discard
            </button>
            <button
              ref={keepEditingButton}
              className="button button-primary"
              type="button"
              onClick={() => setConfirmingDiscard(false)}
            >
              Keep editing
            </button>
          </footer>
        </>
      )}
      <EditorForm
        hidden={confirmingDiscard}
        onSubmit={handleSubmit}
        aria-busy={createEvent.isPending}
      >
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
            onClick={requestClose}
          >
            Cancel
          </button>
          <EditorSubmitButton
            className="button button-primary"
            disabled={createEvent.isPending}
          >
            {createEvent.isPending ? "Creating..." : "Create event"}
          </EditorSubmitButton>
        </footer>
      </EditorForm>
    </dialog>
  );
}
