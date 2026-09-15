"use client";

import type { ReminderResponse } from "@chronelle/schemas";
import { type FormEvent, useMemo, useState } from "react";
import { CountedField } from "../../components/counted-field";
import { EditorForm } from "../../components/editor-form";
import {
  DiscardActions,
  EditorDialogHeader,
} from "../../components/editor-dialog-controls";
import { EditorControls } from "./editor-controls";
import {
  readReminderFields,
  reminderFieldsPayload,
} from "../../lib/reminder-fields";
import {
  eventCreationDraftKeys,
  type ReminderDraftSnapshot,
} from "../../lib/editor-draft-store";
import { useKeepEditorDraft } from "../../lib/editor-draft-context";
import {
  EditorDraftRecovery,
  EditorDraftStatus,
} from "./editor-draft-recovery";
import { usePlanningEditorDialog } from "../../lib/use-planning-editor-dialog";
import { useOpenHistory } from "../history/history-provider";
import { useEditorDraft } from "../../lib/use-editor-draft";
import {
  useCreateReminder,
  useRefreshEvent,
  useUpdateReminder,
  type ContextCreateAttempt,
} from "../../lib/queries";

interface ReminderFormProps {
  readonly eventId: string;
  readonly onCancel?: (() => void) | undefined;
  readonly onRefresh?: (() => Promise<void>) | undefined;
  readonly reminder?: ReminderResponse | undefined;
}

export function ReminderForm(props: ReminderFormProps) {
  const draftId =
    props.reminder?.id ?? eventCreationDraftKeys(props.eventId).reminder;
  return (
    <EditorDraftRecovery
      kind="reminder"
      id={draftId}
      accessId={props.reminder?.id ?? props.eventId}
      onClose={() => props.onCancel?.()}
    >
      {(initialDraft) => (
        <ReminderEditor
          {...props}
          draftId={draftId}
          initialDraft={initialDraft}
        />
      )}
    </EditorDraftRecovery>
  );
}

function ReminderEditor({
  eventId,
  draftId,
  initialDraft,
  onCancel,
  onRefresh,
  reminder: latestReminder,
}: ReminderFormProps & {
  readonly draftId: string;
  readonly initialDraft: ReminderDraftSnapshot | undefined;
}) {
  const draft = useEditorDraft(
    latestReminder,
    readReminderFields,
    initialDraft,
  );
  const reminder = draft.source;
  const [attempt] = useState<ContextCreateAttempt>(
    () => initialDraft?.creationAttempt ?? { current: null },
  );
  const snapshot = useMemo<ReminderDraftSnapshot>(
    () => ({
      ...draft.snapshot,
      kind: "reminder",
      ...(reminder === undefined ? { creationAttempt: attempt } : {}),
    }),
    [draft.snapshot, reminder, attempt],
  );
  const recovery = useKeepEditorDraft(
    draftId,
    snapshot,
    draft.isDirty,
    () => onCancel?.(),
    reminder?.id ?? eventId,
  );
  const create = useCreateReminder(eventId, attempt);
  const update = useUpdateReminder();
  const refresh = useRefreshEvent(eventId, { throwOnError: true });
  const { displayName, remindAt } = draft.fields;
  const mutation = reminder === undefined ? create : update;
  const [timeError, setTimeError] = useState("");
  const openHistory = useOpenHistory();
  const close = () => {
    recovery.discard();
    onCancel?.();
  };
  const {
    headingId,
    nameInput,
    dialog,
    rememberSubmit,
    isConfirming,
    keepEditingButton,
    keepEditing,
    requestClose,
  } = usePlanningEditorDialog({
    isDirty: draft.isDirty,
    mutation,
    onClose: close,
  });

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (
      isConfirming ||
      draft.hasNewerVersion ||
      mutation.isPending ||
      !recovery.isRetained
    )
      return;
    let input: ReturnType<typeof reminderFieldsPayload>;
    try {
      input = reminderFieldsPayload(draft.fields, reminder);
      setTimeError("");
    } catch (error) {
      setTimeError(
        error instanceof Error ? error.message : "Check the reminder time.",
      );
      return;
    }
    rememberSubmit(formEvent.currentTarget);
    if (reminder === undefined) {
      void recovery.save(
        () => create.mutateAsync(input),
        () => {
          draft.change({ displayName: "", remindAt: "" });
          onCancel?.();
        },
      );
      return;
    }
    void recovery.save(
      () =>
        update.mutateAsync({
          id: reminder.id,
          input: { ...input, expectedVersion: reminder.version },
        }),
      (saved) => {
        draft.accept(saved);
        onCancel?.();
      },
    );
  }

  return (
    <dialog
      ref={dialog}
      className={`event-create-dialog${reminder ? " event-inspector" : ""}`}
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
    >
      <EditorDialogHeader
        headingId={headingId}
        title={
          isConfirming
            ? "Discard reminder changes?"
            : reminder
              ? "Edit reminder"
              : "Add reminder"
        }
        closeLabel="Close reminder editor"
        isConfirming={isConfirming}
        isPending={mutation.isPending}
        onClose={requestClose}
      >
        {reminder && (
          <button
            hidden={isConfirming}
            className="button button-quiet button-small"
            type="button"
            aria-label="View reminder history"
            disabled={mutation.isPending}
            onClick={() =>
              openHistory({
                objectId: reminder.id,
                displayName: reminder.displayName,
              })
            }
          >
            History
          </button>
        )}
      </EditorDialogHeader>
      {isConfirming && (
        <div className="event-create-body">
          <p>Your reminder changes have not been saved.</p>
          <div className="form-actions">
            <DiscardActions
              keepEditingButton={keepEditingButton}
              onKeepEditing={keepEditing}
              onDiscard={close}
            />
          </div>
        </div>
      )}
      <EditorForm
        hidden={isConfirming}
        aria-busy={mutation.isPending}
        className="editor-form event-inspector-form"
        onChangeCapture={() => {
          setTimeError("");
          if (mutation.isSuccess) mutation.reset();
        }}
        onSubmit={handleSubmit}
      >
        <div className="event-create-body event-inspector-fields">
          <CountedField
            className="field-wide"
            disabled={mutation.isPending}
            inputRef={nameInput}
            label="Reminder"
            limit={240}
            onChange={(displayName) => draft.change({ displayName })}
            placeholder="Confirm the guest list"
            required
            value={displayName}
          />
          <label className="field">
            <span>Reminder time</span>
            <input
              disabled={mutation.isPending}
              onChange={(input) =>
                draft.change({ remindAt: input.target.value })
              }
              required
              type="datetime-local"
              value={remindAt}
            />
          </label>
          <p className="field-hint">
            Recorded only; no notification is sent. Time in{" "}
            {Intl.DateTimeFormat()
              .resolvedOptions()
              .timeZone.replaceAll("_", " ")}
            .
          </p>
          {timeError && <p role="alert">{timeError}</p>}
        </div>
        <footer className="event-inspector-footer">
          <EditorControls
            disabled={!recovery.isRetained}
            draft={draft}
            mutation={mutation}
            onCancel={requestClose}
            onRefresh={
              reminder === undefined ? undefined : (onRefresh ?? refresh)
            }
            submitLabel={
              reminder === undefined ? "Record reminder" : "Save reminder"
            }
          />
          <EditorDraftStatus
            {...recovery}
            failureMessage={
              reminder === undefined
                ? "The last save could not be confirmed. Retry unchanged fields to reuse the same save attempt."
                : "The last save could not be confirmed. Refresh latest before trying again."
            }
          />
        </footer>
      </EditorForm>
    </dialog>
  );
}
