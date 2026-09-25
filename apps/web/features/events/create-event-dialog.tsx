import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { EventResponse } from "@livtales/schemas";

import { CountedField } from "../../components/counted-field";
import { DescriptionField } from "../../components/description-field";
import { ErrorNotice } from "../../components/feedback";
import { EditorDialogHeader } from "../../components/editor-dialog-controls";
import { EditorForm, EditorSubmitButton } from "../../components/editor-form";
import { descriptionPayload } from "../../lib/description-field";
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
import { useDialogHelp } from "../../lib/use-dialog-help";
import { useDiscardConfirmation } from "../../lib/use-discard-confirmation";
import { locationPayload } from "../../lib/location-field";
import { ScheduleRows } from "./schedule-rows";

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
  const t = useTranslations("eventDialog");
  const editor = useTranslations("editor");
  const common = useTranslations("common");
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
  const help = useDialogHelp("event");
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameInput.current?.focus();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createEvent.isPending || confirmingDiscard || !recovery.isRetained)
      return;
    let timing: ReturnType<typeof eventSchedulePayload>;
    let description: string | null;
    let location: string | null;
    try {
      timing = eventSchedulePayload(schedule);
      description = descriptionPayload(draft.fields.description);
      location = locationPayload(draft.fields.location);
      setScheduleError("");
    } catch (error) {
      setScheduleError(
        error instanceof Error ? error.message : t("checkSchedule"),
      );
      return;
    }
    void recovery.save(
      () =>
        createEvent.mutateAsync({
          displayName,
          description,
          ...timing,
          location,
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
      <EditorDialogHeader
        headingId="new-event-heading"
        title={confirmingDiscard ? t("discardTitle") : t("title")}
        closeLabel={t("close")}
        isConfirming={confirmingDiscard}
        isPending={createEvent.isPending}
        onClose={requestClose}
        help={help}
      />
      {confirmingDiscard && (
        <>
          <div className="event-create-body">
            <p>{t("unsaved")}</p>
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
              {editor("discard")}
            </button>
            <button
              ref={keepEditingButton}
              className="button button-primary"
              type="button"
              onClick={keepEditing}
            >
              {editor("keepEditing")}
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
            label={t("name")}
            limit={240}
            onChange={(displayName) => draft.change({ displayName })}
            placeholder={t("namePlaceholder")}
            required
            value={displayName}
          />
          <DescriptionField
            disabled={createEvent.isPending}
            onChange={(description) => draft.change({ description })}
            value={draft.fields.description}
          />
          <ScheduleRows
            disabled={createEvent.isPending}
            onChange={(change) => {
              draft.change(change);
              setScheduleError("");
            }}
            place={{
              value: draft.fields.location,
              onChange: (location) => draft.change({ location }),
            }}
            value={schedule}
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
            {common("cancel")}
          </button>
          <EditorSubmitButton
            className="button button-primary"
            disabled={createEvent.isPending || !recovery.isRetained}
          >
            {createEvent.isPending ? t("creating") : t("create")}
          </EditorSubmitButton>
        </footer>
      </EditorForm>
    </dialog>
  );
}
