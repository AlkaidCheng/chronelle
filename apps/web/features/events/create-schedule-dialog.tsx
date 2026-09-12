"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { EditorForm, EditorSubmitButton } from "../../components/editor-form";
import { ErrorNotice } from "../../components/feedback";
import {
  type EventScheduleDraft,
  eventSchedulePayload,
  readEventSchedule,
} from "../../lib/event-schedule";
import { useCreateScheduledEvent } from "../../lib/queries";
import { useDiscardConfirmation } from "../../lib/use-discard-confirmation";
import { useEditorDraft } from "../../lib/use-editor-draft";
import { useSessionDialog } from "../../lib/use-session-dialog";
import { EventScheduleFields } from "./event-schedule-fields";

export function CreateScheduleDialog({
  eventId,
  onClose,
}: {
  readonly eventId: string;
  readonly onClose: () => void;
}) {
  const draft = useEditorDraft(
    undefined,
    (): EventScheduleDraft & { displayName: string } => ({
      displayName: "",
      ...readEventSchedule(),
      mode: "dates",
    }),
  );
  const mutation = useCreateScheduledEvent(eventId);
  const [scheduleError, setScheduleError] = useState("");
  const dialog = useSessionDialog(onClose);
  const headingId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const { isConfirming, keepEditingButton, keepEditing, requestClose } =
    useDiscardConfirmation({
      isDirty: draft.isDirty,
      isPending: mutation.isPending,
      onClose,
    });

  useEffect(() => {
    nameInput.current?.focus();
  }, []);
  useEffect(() => {
    if (!draft.isDirty && !mutation.isPending) return;
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [draft.isDirty, mutation.isPending]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending || isConfirming) return;
    let schedule: ReturnType<typeof eventSchedulePayload>;
    try {
      schedule = eventSchedulePayload(draft.fields);
      setScheduleError("");
    } catch (error) {
      setScheduleError(
        error instanceof Error ? error.message : "Check the schedule.",
      );
      return;
    }
    mutation.mutate(
      {
        displayName: draft.fields.displayName,
        ...schedule,
        isAllDay: false,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <dialog
      ref={dialog}
      className="event-create-dialog"
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
    >
      <header className="event-create-header">
        <h2 id={headingId}>
          {isConfirming ? "Discard schedule item?" : "Add schedule item"}
        </h2>
        <button
          hidden={isConfirming}
          type="button"
          className="dialog-close"
          aria-label="Close schedule creation"
          disabled={mutation.isPending}
          onClick={requestClose}
        >
          &#215;
        </button>
      </header>
      {isConfirming && (
        <>
          <div className="event-create-body">
            <p>Your schedule item has not been saved.</p>
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
              onClick={keepEditing}
            >
              Keep editing
            </button>
          </footer>
        </>
      )}
      <EditorForm
        hidden={isConfirming}
        aria-busy={mutation.isPending}
        onSubmit={handleSubmit}
      >
        <div className="event-create-body">
          <label className="field event-name-field">
            Schedule item
            <input
              ref={nameInput}
              maxLength={240}
              disabled={mutation.isPending}
              onChange={(input) =>
                draft.change({ displayName: input.target.value })
              }
              placeholder="Guest arrival"
              required
              value={draft.fields.displayName}
            />
          </label>
          <EventScheduleFields
            value={draft.fields}
            onChange={(fields) => {
              draft.change(fields);
              setScheduleError("");
            }}
            disabled={mutation.isPending}
          />
          {scheduleError && <p role="alert">{scheduleError}</p>}
          {mutation.isError && (
            <>
              <ErrorNotice error={mutation.error} />
              <p className="editor-help">
                Your draft is still here. Use Add to schedule to submit it
                again.
              </p>
            </>
          )}
        </div>
        <footer className="event-create-footer">
          <button
            className="button button-quiet"
            type="button"
            disabled={mutation.isPending}
            onClick={requestClose}
          >
            Cancel
          </button>
          <EditorSubmitButton
            className="button button-primary"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Saving..." : "Add to schedule"}
          </EditorSubmitButton>
        </footer>
      </EditorForm>
    </dialog>
  );
}
