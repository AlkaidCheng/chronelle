import { type FormEvent, useEffect, useRef, useState } from "react";
import type { EventResponse } from "@chronelle/schemas";

import { ErrorNotice } from "../../components/feedback";
import { EditorForm, EditorSubmitButton } from "../../components/editor-form";
import { eventSchedulePayload } from "../../lib/event-schedule";
import { useEditorDraft } from "../../lib/use-editor-draft";
import { useKeepEventDraft } from "../../lib/event-draft-context";
import {
  readEventFields,
  type EventDraftSnapshot,
} from "../../lib/event-draft-store";
import { EventDraftRecovery, EventDraftStatus } from "./event-draft-recovery";
import { useCreateEvent } from "../../lib/queries";
import { useSessionDialog } from "../../lib/use-session-dialog";
import { EventScheduleFields } from "./event-schedule-fields";

interface CreateEventDialogProps {
  readonly onCreated: (id: string) => void;
  readonly onClose: () => void;
}

export function CreateEventDialog(props: CreateEventDialogProps) {
  return (
    <EventDraftRecovery id="new" onClose={props.onClose}>
      {(initialDraft) => (
        <CreateEventForm {...props} initialDraft={initialDraft} />
      )}
    </EventDraftRecovery>
  );
}

function CreateEventForm({
  onCreated,
  onClose,
  initialDraft,
}: CreateEventDialogProps & {
  readonly initialDraft: EventDraftSnapshot | undefined;
}) {
  const createEvent = useCreateEvent();
  const draft = useEditorDraft<
    EventResponse,
    ReturnType<typeof readEventFields>
  >(undefined, readEventFields, initialDraft);
  const { displayName } = draft.fields;
  const schedule = draft.fields;
  const { isDirty } = draft;
  const recovery = useKeepEventDraft("new", draft.snapshot, isDirty, onClose);
  const [scheduleError, setScheduleError] = useState("");
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const dialog = useSessionDialog(onClose);
  const nameInput = useRef<HTMLInputElement>(null);
  const keepEditingButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    nameInput.current?.focus();
  }, []);

  useEffect(() => {
    if (confirmingDiscard) keepEditingButton.current?.focus();
    else if (returnFocus.current?.isConnected) returnFocus.current.focus();
  }, [confirmingDiscard]);

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
    if (createEvent.isPending || confirmingDiscard || !recovery.isRetained)
      return;
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
    void recovery.save(
      () =>
        createEvent.mutateAsync({
          displayName,
          ...timing,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      (created) => {
        onClose();
        onCreated(created.id);
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
              onClick={() => {
                recovery.discard();
                onClose();
              }}
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
              onChange={(event) =>
                draft.change({ displayName: event.target.value })
              }
            />
          </label>
          <EventScheduleFields
            value={schedule}
            onChange={(change) => {
              draft.change(change);
              setScheduleError("");
            }}
            disabled={createEvent.isPending}
          />
          {scheduleError && <p role="alert">{scheduleError}</p>}
          {createEvent.isError && <ErrorNotice error={createEvent.error} />}
          <EventDraftStatus {...recovery} />
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
            disabled={createEvent.isPending || !recovery.isRetained}
          >
            {createEvent.isPending ? "Creating..." : "Create event"}
          </EditorSubmitButton>
        </footer>
      </EditorForm>
    </dialog>
  );
}
