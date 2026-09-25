"use client";

import type { EventResponse } from "@livtales/schemas";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { CountedField } from "../../components/counted-field";
import { EditorForm } from "../../components/editor-form";
import {
  DiscardActions,
  EditorDialogHeader,
} from "../../components/editor-dialog-controls";
import { eventSchedulePayload } from "../../lib/event-schedule";
import { DescriptionField } from "../../components/description-field";
import { descriptionPayload } from "../../lib/description-field";
import { locationPayload } from "../../lib/location-field";
import { useKeepEditorDraft } from "../../lib/editor-draft-context";
import {
  readEventFields,
  type EventDraftSnapshot,
  type EventFields,
} from "../../lib/editor-draft-store";
import {
  EditorDraftRecovery,
  EditorDraftStatus,
} from "./editor-draft-recovery";
import { useRefreshEvent, useUpdateEvent } from "../../lib/queries";
import { useEditorDraft } from "../../lib/use-editor-draft";
import { useSessionDialog } from "../../lib/use-session-dialog";
import { useDialogHelp } from "../../lib/use-dialog-help";
import { useDiscardConfirmation } from "../../lib/use-discard-confirmation";
import { useOpenHistory } from "../history/history-provider";
import type { FieldFormatter } from "./conflict-notice";
import { EditorControls, useConflictSlot } from "./editor-controls";
import { ScheduleRows } from "./schedule-rows";

interface EventInspectorProps {
  readonly event: EventResponse;
  readonly onClose: () => void;
  readonly title?: string;
  /** Where the editor opens: the name, or the schedule when setting dates. */
  readonly initialFocus?: "name" | "schedule";
  /** The fields the editor starts with when a composer hands over to it. */
  readonly start?: Partial<EventFields> | undefined;
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
  title,
  initialFocus = "name",
  start,
}: EventInspectorProps & {
  readonly initialDraft: EventDraftSnapshot | undefined;
}) {
  const conflictSlot = useConflictSlot();
  const draft = useEditorDraft(latestEvent, readEventFields, initialDraft);
  // A composer's fields seed a fresh draft once; a recovered draft keeps
  // what it had.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || start === undefined || initialDraft !== undefined)
      return;
    seeded.current = true;
    draft.change(start);
  }, [draft, initialDraft, start]);
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
  const modes = useTranslations("conflict.modes");
  const formatEventField: FieldFormatter = (key, value) => {
    const mode = value as Parameters<typeof modes>[0];
    return key === "mode" && modes.has(mode) ? modes(mode) : undefined;
  };
  const nameId = useId();
  const headingId = useId();
  const openHistory = useOpenHistory();
  const update = useUpdateEvent();
  const refresh = useRefreshEvent(event.id, { throwOnError: true });
  const { displayName } = draft.fields;
  const t = useTranslations("eventEditor");
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
  const help = useDialogHelp("event");
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const name = nameInput.current;
    if (initialFocus === "schedule") {
      const dates = name
        ?.closest("dialog")
        ?.querySelector<HTMLElement>(".schedule-rows .field-row-main");
      if (dates) {
        dates.focus();
        return;
      }
    }
    name?.focus();
  }, [initialFocus]);
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
    let place: { location: string | null };
    let description: string | null;
    try {
      schedule = eventSchedulePayload(draft.fields);
      place = { location: locationPayload(draft.fields.location) };
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
        update.mutateAsync({
          id: event.id,
          workspaceId: event.workspaceId,
          input: {
            displayName,
            description,
            ...schedule,
            ...place,
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
      className="event-create-dialog"
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
    >
      <EditorDialogHeader
        headingId={headingId}
        title={confirmingDiscard ? t("discardTitle") : (title ?? t("title"))}
        closeLabel={t("close")}
        isConfirming={confirmingDiscard}
        isPending={update.isPending}
        onClose={requestClose}
        help={help}
      >
        <button
          hidden={confirmingDiscard}
          className="button button-quiet button-small"
          type="button"
          aria-label={t("viewHistory")}
          disabled={update.isPending}
          onClick={() =>
            openHistory({
              objectId: event.id,
              displayName: latestEvent.displayName,
            })
          }
        >
          {t("history")}
        </button>
      </EditorDialogHeader>
      {confirmingDiscard && (
        <div className="event-create-body">
          <p>{t("unsaved")}</p>
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
          <div className="editor-conflict-slot" ref={conflictSlot.ref} />
          <CountedField
            className="field-wide"
            disabled={update.isPending}
            id={nameId}
            inputRef={nameInput}
            label={t("name")}
            limit={240}
            onChange={(displayName) => draft.change({ displayName })}
            required
            value={displayName}
          />
          <DescriptionField
            disabled={update.isPending}
            onChange={(description) => {
              draft.change({ description });
              if (update.isSuccess) update.reset();
            }}
            value={draft.fields.description}
          />
          <ScheduleRows
            disabled={update.isPending}
            onChange={(fields) => {
              draft.change(fields);
              setScheduleError("");
              if (update.isSuccess) update.reset();
            }}
            place={{
              value: draft.fields.location,
              onChange: (location) => {
                draft.change({ location });
                if (update.isSuccess) update.reset();
              },
            }}
            value={draft.fields}
          />
          {scheduleError && <p role="alert">{scheduleError}</p>}
          <EditorDraftStatus {...recovery} />
        </div>
        <footer className="event-inspector-footer">
          <EditorControls
            conflict={{
              objectId: event.id,
              format: formatEventField,
              slot: conflictSlot.slot,
            }}
            draft={draft}
            mutation={update}
            onCancel={requestClose}
            onRefresh={refresh}
            submitLabel={t("save")}
            disabled={!recovery.isRetained}
          />
        </footer>
      </EditorForm>
    </dialog>
  );
}
