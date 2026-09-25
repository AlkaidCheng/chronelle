"use client";

import type { NoteResponse } from "@livtales/schemas";
import { useTranslations } from "next-intl";
import { type FormEvent, useMemo, useState } from "react";
import { CountedField } from "../../components/counted-field";
import { EditorForm } from "../../components/editor-form";
import {
  DiscardActions,
  EditorDialogHeader,
} from "../../components/editor-dialog-controls";
import { EditorControls, useConflictSlot } from "./editor-controls";
import {
  noteBodyRows,
  noteFieldsPayload,
  readNoteFields,
} from "../../lib/note-fields";
import {
  eventCreationDraftKeys,
  type NoteDraftSnapshot,
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
  useCreateNote,
  useRefreshEvent,
  useUpdateNote,
  type ContextCreateAttempt,
} from "../../lib/queries";

const bodyLimit = 20_000;

interface NoteFormProps {
  readonly eventId: string;
  readonly onCancel?: (() => void) | undefined;
  readonly onRefresh?: (() => Promise<void>) | undefined;
  readonly note?: NoteResponse | undefined;
}

/** The note editor: a title and the text, as the focused dialog every record has. */
export function NoteForm(props: NoteFormProps) {
  const draftId = props.note?.id ?? eventCreationDraftKeys(props.eventId).note;
  return (
    <EditorDraftRecovery
      kind="note"
      id={draftId}
      accessId={props.note?.id ?? props.eventId}
      onClose={() => props.onCancel?.()}
    >
      {(initialDraft) => (
        <NoteEditor {...props} draftId={draftId} initialDraft={initialDraft} />
      )}
    </EditorDraftRecovery>
  );
}

function NoteEditor({
  eventId,
  draftId,
  initialDraft,
  onCancel,
  onRefresh,
  note: latestNote,
}: NoteFormProps & {
  readonly draftId: string;
  readonly initialDraft: NoteDraftSnapshot | undefined;
}) {
  const conflictSlot = useConflictSlot();
  const draft = useEditorDraft(latestNote, readNoteFields, initialDraft);
  const note = draft.source;
  const [attempt] = useState<ContextCreateAttempt>(
    () => initialDraft?.creationAttempt ?? { current: null },
  );
  const snapshot = useMemo<NoteDraftSnapshot>(
    () => ({
      ...draft.snapshot,
      kind: "note",
      ...(note === undefined ? { creationAttempt: attempt } : {}),
    }),
    [draft.snapshot, note, attempt],
  );
  const recovery = useKeepEditorDraft(
    draftId,
    snapshot,
    draft.isDirty,
    () => onCancel?.(),
    note?.id ?? eventId,
  );
  const create = useCreateNote(eventId, attempt);
  const update = useUpdateNote();
  const refresh = useRefreshEvent(eventId, { throwOnError: true });
  const { displayName, body } = draft.fields;
  const mutation = note === undefined ? create : update;
  const t = useTranslations("note");
  const editor = useTranslations("editor");
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
  const help = useDialogHelp("note");

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (
      isConfirming ||
      draft.hasNewerVersion ||
      mutation.isPending ||
      !recovery.isRetained
    )
      return;
    const input = noteFieldsPayload(draft.fields);
    rememberSubmit(formEvent.currentTarget);
    if (note === undefined) {
      void recovery.save(
        () => create.mutateAsync(input),
        () => {
          draft.change({ displayName: "", body: "" });
          onCancel?.();
        },
      );
      return;
    }
    void recovery.save(
      () =>
        update.mutateAsync({
          id: note.id,
          input: { ...input, expectedVersion: note.version },
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
          isConfirming ? t("discardTitle") : note ? t("editTitle") : t("title")
        }
        closeLabel={t("close")}
        isConfirming={isConfirming}
        isPending={mutation.isPending}
        onClose={requestClose}
        help={help}
      >
        {note && (
          <button
            hidden={isConfirming}
            className="button button-quiet button-small"
            type="button"
            aria-label={t("viewHistory")}
            disabled={mutation.isPending}
            onClick={() =>
              openHistory({ objectId: note.id, displayName: note.displayName })
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
            onChange={(value) => draft.change({ displayName: value })}
            required
            value={displayName}
          />
          <label className="field field-wide">
            <span>{t("body")}</span>
            <textarea
              className="note-body-field"
              disabled={mutation.isPending}
              maxLength={bodyLimit}
              onChange={(input) => draft.change({ body: input.target.value })}
              rows={noteBodyRows(body)}
              value={body}
            />
          </label>
        </div>
        <footer className="event-inspector-footer">
          <EditorControls
            conflict={
              note === undefined
                ? undefined
                : { objectId: note.id, slot: conflictSlot.slot }
            }
            disabled={!recovery.isRetained}
            draft={draft}
            mutation={mutation}
            onCancel={requestClose}
            onRefresh={note === undefined ? undefined : (onRefresh ?? refresh)}
            submitLabel={t("save")}
          />
          <EditorDraftStatus
            {...recovery}
            failureMessage={
              note === undefined
                ? editor("failureRetry")
                : editor("failureRefresh")
            }
          />
        </footer>
      </EditorForm>
    </dialog>
  );
}
