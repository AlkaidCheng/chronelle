import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { EventResponse } from "@chronelle/schemas";

import { CountedField } from "../../components/counted-field";
import { ErrorNotice } from "../../components/feedback";
import { EditorForm, EditorSubmitButton } from "../../components/editor-form";
import { eventSchedulePayload } from "../../lib/event-schedule";
import { shownTimeZone } from "../../i18n/active-preferences";
import { useEditorDraft } from "../../lib/use-editor-draft";
import { useKeepEditorDraft } from "../../lib/editor-draft-context";
import {
  readEventFields,
  type EventDraftSnapshot,
} from "../../lib/editor-draft-store";
import {
  EditorDraftRecovery,
  EditorDraftStatus,
} from "./editor-draft-recovery";
import { useCreateEvent } from "../../lib/queries";
import { useSessionDialog } from "../../lib/use-session-dialog";
import { useDiscardConfirmation } from "../../lib/use-discard-confirmation";
import { EventScheduleFields } from "./event-schedule-fields";

interface CreateEventDialogProps {
  readonly onCreated: (id: string) => void;
  readonly onClose: () => void;
}

export function CreateEventDialog(props: CreateEventDialogProps) {
  return (
    <EditorDraftRecovery kind="event" id="new" onClose={props.onClose}>
      {(initialDraft) => (
        <CreateEventForm {...props} initialDraft={initialDraft} />
      )}
    </EditorDraftRecovery>
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
  const snapshot = useMemo<EventDraftSnapshot>(
    () => ({ ...draft.snapshot, kind: "event" }),
    [draft.snapshot],
  );
  const recovery = useKeepEditorDraft("new", snapshot, isDirty, onClose);
  const [scheduleError, setScheduleError] = useState("");
  const {
    isConfirming: confirmingDiscard,
    keepEditingButton,
    keepEditing,
    requestClose,
  } = useDiscardConfirmation({
    isDirty: draft.isDirty,
    isPending: createEvent.isPending,
    onClose,
  });
  const dialog = useSessionDialog(onClose);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameInput.current?.focus();
  }, []);

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
          timezone: shownTimeZone(),
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
              onClick={keepEditing}
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
          <CountedField
            className="event-name-field"
            disabled={createEvent.isPending}
            inputRef={nameInput}
            label="Event name"
            limit={240}
            onChange={(displayName) => draft.change({ displayName })}
            placeholder="What are you planning?"
            required
            value={displayName}
          />
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
          <EditorDraftStatus {...recovery} />
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
