"use client";

import { useTranslations } from "next-intl";
import {
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EventResponse } from "@chronelle/schemas";
import { CountedField } from "../../components/counted-field";
import { EditorForm, EditorSubmitButton } from "../../components/editor-form";
import {
  DiscardActions,
  EditorDialogHeader,
} from "../../components/editor-dialog-controls";
import { ErrorNotice } from "../../components/feedback";
import { eventSchedulePayload } from "../../lib/event-schedule";
import { DescriptionField } from "../../components/description-field";
import { descriptionPayload } from "../../lib/description-field";
import { locationPayload } from "../../lib/location-field";
import { shownTimeZone } from "../../i18n/active-preferences";
import {
  useCreateScheduledEvent,
  type ContextCreateAttempt,
} from "../../lib/queries";
import { useKeepEditorDraft } from "../../lib/editor-draft-context";
import {
  readEventFields,
  eventCreationDraftKeys,
  type EventDraftSnapshot,
} from "../../lib/editor-draft-store";
import { useDiscardConfirmation } from "../../lib/use-discard-confirmation";
import { useEditorDraft } from "../../lib/use-editor-draft";
import { useSessionDialog } from "../../lib/use-session-dialog";
import { ScheduleRows } from "./schedule-rows";
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
  const draftId = eventCreationDraftKeys(eventId).schedule;
  return (
    <EditorDraftRecovery
      kind="event"
      id={draftId}
      accessId={eventId}
      onClose={onClose}
    >
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
  >(undefined, () => readEventFields(), initialDraft);
  const [attempt] = useState<ContextCreateAttempt>(
    () => initialDraft?.creationAttempt ?? { current: null },
  );
  const snapshot = useMemo<EventDraftSnapshot>(
    () => ({ ...draft.snapshot, kind: "event", creationAttempt: attempt }),
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
  const t = useTranslations("scheduleDialog");
  const editor = useTranslations("editor");
  const common = useTranslations("common");
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
    let location: string | null;
    let description: string | null;
    try {
      schedule = eventSchedulePayload(draft.fields);
      location = locationPayload(draft.fields.location);
      description = descriptionPayload(draft.fields.description);
      setScheduleError("");
    } catch (error) {
      setScheduleError(
        error instanceof Error ? error.message : t("checkSchedule"),
      );
      return;
    }
    void recovery.save(
      () =>
        mutation.mutateAsync({
          displayName: draft.fields.displayName,
          ...schedule,
          isAllDay: false,
          timezone: shownTimeZone(),
          location,
          description,
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
        title={isConfirming ? t("discardTitle") : t("title")}
        closeLabel={t("close")}
        isConfirming={isConfirming}
        isPending={mutation.isPending}
        onClose={requestClose}
      />
      {isConfirming && (
        <>
          <div className="event-create-body">
            <p>{t("unsaved")}</p>
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
          <CountedField
            className="event-name-field"
            disabled={mutation.isPending}
            inputRef={nameInput}
            label={t("name")}
            limit={240}
            onChange={(displayName) => draft.change({ displayName })}
            placeholder={t("namePlaceholder")}
            required
            value={draft.fields.displayName}
          />
          <DescriptionField
            disabled={mutation.isPending}
            onChange={(description) => draft.change({ description })}
            value={draft.fields.description}
          />
          <ScheduleRows
            disabled={mutation.isPending}
            onChange={(fields) => {
              draft.change(fields);
              setScheduleError("");
            }}
            place={{
              value: draft.fields.location,
              onChange: (location) => draft.change({ location }),
            }}
            value={draft.fields}
          />
          {scheduleError && <p role="alert">{scheduleError}</p>}
          {mutation.isError && <ErrorNotice error={mutation.error} />}
          <EditorDraftStatus
            {...recovery}
            failureMessage={editor("failureRetry")}
          />
        </div>
        <footer className="event-create-footer">
          <button
            className="button button-quiet"
            type="button"
            disabled={mutation.isPending}
            onClick={requestClose}
          >
            {common("cancel")}
          </button>
          <EditorSubmitButton
            className="button button-primary"
            disabled={mutation.isPending || !recovery.isRetained}
          >
            {mutation.isPending ? editor("saving") : t("add")}
          </EditorSubmitButton>
        </footer>
      </EditorForm>
    </dialog>
  );
}
