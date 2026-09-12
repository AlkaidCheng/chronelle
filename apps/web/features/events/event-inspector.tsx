"use client";

import type { EventResponse } from "@chronelle/schemas";
import {
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { EditorForm } from "../../components/editor-form";
import {
  DiscardActions,
  EditorDialogHeader,
} from "../../components/editor-dialog-controls";
import { eventSchedulePayload } from "../../lib/event-schedule";
import { useKeepEditorDraft } from "../../lib/editor-draft-context";
import {
  readEventFields,
  type EventDraftSnapshot,
} from "../../lib/editor-draft-store";
import {
  EditorDraftRecovery,
  EditorDraftStatus,
} from "./editor-draft-recovery";
import { useRefreshEvent, useUpdateEvent } from "../../lib/queries";
import { useEditorDraft } from "../../lib/use-editor-draft";
import { useSessionDialog } from "../../lib/use-session-dialog";
import { useDiscardConfirmation } from "../../lib/use-discard-confirmation";
import { useOpenHistory } from "../history/history-provider";
import { EditorControls } from "./editor-controls";
import { EventScheduleFields } from "./event-schedule-fields";

interface EventInspectorProps {
  readonly event: EventResponse;
  readonly onClose: () => void;
  readonly title?: string;
}

export function EventInspector(props: EventInspectorProps) {
  return (
    <EditorDraftRecovery
      kind="event"
      id={props.event.id}
      onClose={props.onClose}
    >
      {(initialDraft) => (
        <EventInspectorForm {...props} initialDraft={initialDraft} />
      )}
    </EditorDraftRecovery>
  );
}

function EventInspectorForm({
  event: latestEvent,
  onClose,
  initialDraft,
  title = "Edit event",
}: EventInspectorProps & {
  readonly initialDraft: EventDraftSnapshot | undefined;
}) {
  const draft = useEditorDraft(latestEvent, readEventFields, initialDraft);
  const snapshot = useMemo<EventDraftSnapshot>(
    () => ({ ...draft.snapshot, kind: "event" }),
    [draft.snapshot],
  );
  const recovery = useKeepEditorDraft(
    latestEvent.id,
    snapshot,
    draft.isDirty,
    onClose,
  );
  const event = draft.source ?? latestEvent;
  const nameId = useId();
  const headingId = useId();
  const openHistory = useOpenHistory();
  const update = useUpdateEvent();
  const refresh = useRefreshEvent(event.id, { throwOnError: true });
  const { displayName } = draft.fields;
  const [scheduleError, setScheduleError] = useState("");

  const {
    isConfirming: confirmingDiscard,
    keepEditingButton,
    keepEditing,
    requestClose,
  } = useDiscardConfirmation({
    isDirty: draft.isDirty,
    isPending: update.isPending,
    onClose,
  });
  const dialog = useSessionDialog(onClose);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInput.current?.focus();
  }, []);
  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (
      confirmingDiscard ||
      draft.hasNewerVersion ||
      update.isPending ||
      !recovery.isRetained
    )
      return;
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
    void recovery.save(
      () =>
        update.mutateAsync({
          id: event.id,
          input: {
            displayName,
            ...schedule,
            expectedVersion: event.version,
            isAllDay: draft.fields.mode === "timed" && event.isAllDay,
            timezone: event.timezone,
          },
        }),
      (saved) => {
        draft.accept(saved);
        onClose();
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
      <EditorDialogHeader
        headingId={headingId}
        title={confirmingDiscard ? "Discard changes?" : title}
        closeLabel="Close event editor"
        isConfirming={confirmingDiscard}
        isPending={update.isPending}
        onClose={requestClose}
      >
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
      </EditorDialogHeader>
      {confirmingDiscard && (
        <div className="event-create-body">
          <p>Your changes have not been saved.</p>
          <div className="form-actions">
            <DiscardActions
              keepEditingButton={keepEditingButton}
              onKeepEditing={keepEditing}
              onDiscard={() => {
                recovery.discard();
                onClose();
              }}
            />
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
          <EditorDraftStatus {...recovery} />
        </div>
        <footer className="event-inspector-footer">
          <EditorControls
            draft={draft}
            mutation={update}
            onCancel={requestClose}
            onRefresh={refresh}
            submitLabel="Save event"
            disabled={!recovery.isRetained}
          />
        </footer>
      </EditorForm>
    </dialog>
  );
}
