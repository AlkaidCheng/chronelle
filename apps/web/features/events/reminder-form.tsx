"use client";

import type { ReminderResponse } from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CountedField } from "../../components/counted-field";
import { EditorForm } from "../../components/editor-form";
import {
  DiscardActions,
  EditorDialogHeader,
} from "../../components/editor-dialog-controls";
import { EditorControls, useConflictSlot } from "./editor-controls";
import {
  readReminderFields,
  type ReminderFields,
  reminderFieldsPayload,
} from "../../lib/reminder-fields";
import { MomentRow } from "../../components/moment-row";
import {
  eventCreationDraftKeys,
  type ReminderDraftSnapshot,
} from "../../lib/editor-draft-store";
import { useKeepEditorDraft } from "../../lib/editor-draft-context";
import {
  EditorDraftRecovery,
  EditorDraftStatus,
} from "./editor-draft-recovery";
import { useDialogHelp } from "../../lib/use-dialog-help";
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
  /** The fields the editor starts with when a composer hands over to it. */
  readonly start?: Partial<ReminderFields> | undefined;
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
  start,
}: ReminderFormProps & {
  readonly draftId: string;
  readonly initialDraft: ReminderDraftSnapshot | undefined;
}) {
  const conflictSlot = useConflictSlot();
  const draft = useEditorDraft(
    latestReminder,
    readReminderFields,
    initialDraft,
  );
  // A composer's fields seed a fresh draft once; a recovered draft keeps
  // what it had.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || start === undefined || initialDraft !== undefined)
      return;
    seeded.current = true;
    draft.change(start);
  }, [draft, initialDraft, start]);
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
  const t = useTranslations("reminderForm");
  const editor = useTranslations("editor");
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
  const help = useDialogHelp("reminder");

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
      setTimeError(error instanceof Error ? error.message : t("checkTime"));
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
      className="event-create-dialog"
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
            ? t("discardTitle")
            : reminder
              ? t("editTitle")
              : t("addTitle")
        }
        closeLabel={t("close")}
        isConfirming={isConfirming}
        isPending={mutation.isPending}
        onClose={requestClose}
        help={help}
      >
        {reminder && (
          <button
            hidden={isConfirming}
            className="button button-quiet button-small"
            type="button"
            aria-label={t("viewHistory")}
            disabled={mutation.isPending}
            onClick={() =>
              openHistory({
                objectId: reminder.id,
                displayName: reminder.displayName,
              })
            }
          >
            {editor("history")}
          </button>
        )}
      </EditorDialogHeader>
      {isConfirming && (
        <div className="event-create-body">
          <p>{t("unsaved")}</p>
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
          <div className="editor-conflict-slot" ref={conflictSlot.ref} />
          <CountedField
            className="field-wide"
            disabled={mutation.isPending}
            inputRef={nameInput}
            label={t("name")}
            limit={240}
            onChange={(displayName) => draft.change({ displayName })}
            placeholder={t("namePlaceholder")}
            required
            value={displayName}
          />
          <MomentRow
            clearLabel={t("clearTime")}
            defaultTime="09:00"
            disabled={mutation.isPending}
            hint={t("timeHint")}
            label={t("time")}
            onChange={(remindAt) => draft.change({ remindAt })}
            setLabel={t("setTime")}
            value={remindAt}
          />
          {timeError && <p role="alert">{timeError}</p>}
        </div>
        <footer className="event-inspector-footer">
          <EditorControls
            conflict={
              reminder === undefined
                ? undefined
                : { objectId: reminder.id, slot: conflictSlot.slot }
            }
            disabled={!recovery.isRetained}
            draft={draft}
            mutation={mutation}
            onCancel={requestClose}
            onRefresh={
              reminder === undefined ? undefined : (onRefresh ?? refresh)
            }
            submitLabel={reminder === undefined ? t("create") : t("save")}
          />
          <EditorDraftStatus
            {...recovery}
            failureMessage={
              reminder === undefined
                ? editor("failureRetry")
                : editor("failureRefresh")
            }
          />
        </footer>
      </EditorForm>
    </dialog>
  );
}
