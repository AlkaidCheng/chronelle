"use client";

import {
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EventResponse } from "@chronelle/schemas";
import { EditorForm, EditorSubmitButton } from "../../components/editor-form";
import {
  DiscardActions,
  EditorDialogHeader,
} from "../../components/editor-dialog-controls";
import { ErrorNotice } from "../../components/feedback";
import { eventSchedulePayload } from "../../lib/event-schedule";
import {
  useCreateScheduledEvent,
  type ContextCreateAttempt,
} from "../../lib/queries";
import { useKeepEditorDraft } from "../../lib/editor-draft-context";
import {
  readEventFields,
  type EventDraftSnapshot,
} from "../../lib/editor-draft-store";
import { useDiscardConfirmation } from "../../lib/use-discard-confirmation";
import { useEditorDraft } from "../../lib/use-editor-draft";
import { useSessionDialog } from "../../lib/use-session-dialog";
import { EventScheduleFields } from "./event-schedule-fields";
import {
  EditorDraftRecovery,
  EditorDraftStatus,
} from "./editor-draft-recovery";

interface CreateScheduleDialogProps {
  readonly eventId: string;
  readonly onClose: () => void;
}

export function CreateScheduleDialog({
  eventId,
  onClose,
}: CreateScheduleDialogProps) {
  const draftId = `schedule:${eventId}`;
  return (
    <EditorDraftRecovery id={draftId} accessId={eventId} onClose={onClose}>
      {(initialDraft) => (
        <CreateScheduleForm
          eventId={eventId}
          draftId={draftId}
          initialDraft={initialDraft}
          onClose={onClose}
        />
      )}
    </EditorDraftRecovery>
  );
}

function CreateScheduleForm({
  eventId,
  draftId,
  initialDraft,
  onClose,
}: CreateScheduleDialogProps & {
  readonly draftId: string;
  readonly initialDraft: EventDraftSnapshot | undefined;
}) {
  const draft = useEditorDraft<
    EventResponse,
    ReturnType<typeof readEventFields>
  >(
    undefined,
    () => ({
      ...readEventFields(),
      mode: "dates",
    }),
    initialDraft,
  );
  const [attempt] = useState<ContextCreateAttempt>(
    () => initialDraft?.creationAttempt ?? { current: null },
  );
  const snapshot = useMemo(
    () => ({ ...draft.snapshot, creationAttempt: attempt }),
    [draft.snapshot, attempt],
  );
  const recovery = useKeepEditorDraft(
    draftId,
    snapshot,
    draft.isDirty,
    onClose,
    eventId,
  );
  const mutation = useCreateScheduledEvent(eventId, attempt);
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
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending || isConfirming || !recovery.isRetained) return;
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
        mutation.mutateAsync({
          displayName: draft.fields.displayName,
          ...schedule,
          isAllDay: false,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      onClose,
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
      <EditorDialogHeader
        headingId={headingId}
        title={isConfirming ? "Discard schedule item?" : "Add schedule item"}
        closeLabel="Close schedule creation"
        isConfirming={isConfirming}
        isPending={mutation.isPending}
        onClose={requestClose}
      />
      {isConfirming && (
        <>
          <div className="event-create-body">
            <p>The name and schedule entered here will be cleared.</p>
          </div>
          <footer className="event-create-footer">
            <DiscardActions
              keepEditingButton={keepEditingButton}
              onKeepEditing={keepEditing}
              onDiscard={() => {
                recovery.discard();
                onClose();
              }}
            />
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
          {mutation.isError && <ErrorNotice error={mutation.error} />}
          <EditorDraftStatus
            {...recovery}
            failureMessage="Your previous save could not be confirmed. Retry unchanged fields to reuse the same save attempt."
          />
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
            disabled={mutation.isPending || !recovery.isRetained}
          >
            {mutation.isPending ? "Saving..." : "Add to schedule"}
          </EditorSubmitButton>
        </footer>
      </EditorForm>
    </dialog>
  );
}
