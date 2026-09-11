"use client";

import type { EventResponse } from "@chronelle/schemas";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { EditorForm } from "../../components/editor-form";
import {
  eventSchedulePayload,
  readEventSchedule,
} from "../../lib/event-schedule";
import { useRefreshEvent, useUpdateEvent } from "../../lib/queries";
import { useEditorDraft } from "../../lib/use-editor-draft";
import { useSessionDialog } from "../../lib/use-session-dialog";
import { useOpenHistory } from "../history/history-provider";
import { EditorControls } from "./editor-controls";
import { EventScheduleFields } from "./event-schedule-fields";

export function EventInspector({
  event: latestEvent,
  onClose,
}: {
  readonly event: EventResponse;
  readonly onClose: () => void;
}) {
  const draft = useEditorDraft(latestEvent, (event) => ({
    displayName: event?.displayName ?? "",
    ...readEventSchedule(event),
  }));
  const event = draft.source ?? latestEvent;
  const nameId = useId();
  const headingId = useId();
  const openHistory = useOpenHistory();
  const update = useUpdateEvent();
  const refresh = useRefreshEvent(event.id, { throwOnError: true });
  const { displayName } = draft.fields;
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
  useEffect(() => {
    if (!draft.isDirty && !update.isPending) return;
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [draft.isDirty, update.isPending]);

  function requestClose() {
    if (update.isPending) return;
    if (confirmingDiscard) setConfirmingDiscard(false);
    else if (draft.isDirty) {
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : nameInput.current;
      setConfirmingDiscard(true);
    } else onClose();
  }

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (confirmingDiscard || draft.hasNewerVersion || update.isPending) return;
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
    update.mutate(
      {
        id: event.id,
        input: {
          displayName,
          ...schedule,
          expectedVersion: event.version,
          isAllDay: draft.fields.mode === "timed" && event.isAllDay,
          timezone: event.timezone,
        },
      },
      {
        onSuccess: (saved) => {
          draft.accept(saved);
          onClose();
        },
      },
    );
  }

  return (
    <dialog
      ref={dialog}
      className="event-create-dialog event-inspector"
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
    >
      <header className="event-create-header">
        <h2 id={headingId}>
          {confirmingDiscard ? "Discard changes?" : "Edit event"}
        </h2>
        <button
          hidden={confirmingDiscard}
          className="button button-quiet button-small"
          type="button"
          aria-label="View event history"
          disabled={update.isPending}
          onClick={() =>
            openHistory({
              objectId: event.id,
              displayName: latestEvent.displayName,
            })
          }
        >
          History
        </button>
        <button
          hidden={confirmingDiscard}
          className="dialog-close"
          type="button"
          aria-label="Close event editor"
          disabled={update.isPending}
          onClick={requestClose}
        >
          &#215;
        </button>
      </header>
      {confirmingDiscard && (
        <div className="event-create-body">
          <p>Your changes have not been saved.</p>
          <div className="form-actions">
            <button
              type="button"
              className="button button-quiet"
              onClick={onClose}
            >
              Discard
            </button>
            <button
              ref={keepEditingButton}
              type="button"
              className="button button-primary"
              onClick={() => setConfirmingDiscard(false)}
            >
              Keep editing
            </button>
          </div>
        </div>
      )}
      <EditorForm
        hidden={confirmingDiscard}
        aria-busy={update.isPending}
        className="editor-form event-inspector-form"
        onChangeCapture={() => {
          if (update.isSuccess) update.reset();
        }}
        onSubmit={handleSubmit}
      >
        <div className="event-create-body event-inspector-fields">
          <label className="field field-wide" htmlFor={nameId}>
            <span>Name</span>
            <input
              ref={nameInput}
              id={nameId}
              maxLength={240}
              disabled={update.isPending}
              onChange={(input) =>
                draft.change({ displayName: input.target.value })
              }
              required
              value={displayName}
            />
          </label>
          <EventScheduleFields
            value={draft.fields}
            onChange={(fields) => {
              draft.change(fields);
              setScheduleError("");
              if (update.isSuccess) update.reset();
            }}
            disabled={update.isPending}
          />
          {scheduleError && <p role="alert">{scheduleError}</p>}
        </div>
        <footer className="event-inspector-footer">
          <EditorControls
            draft={draft}
            mutation={update}
            onCancel={requestClose}
            onRefresh={refresh}
            submitLabel="Save event"
          />
        </footer>
      </EditorForm>
    </dialog>
  );
}
