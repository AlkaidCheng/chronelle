"use client";

import type { ReminderResponse } from "@livtales/schemas";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useRef, useState } from "react";

import { Chip } from "../../components/chip";
import { Composer } from "../../components/composer";
import { DatePanel } from "../../components/date-panel";
import { ErrorNotice } from "../../components/feedback";
import { BellIcon } from "../../components/icons";
import type { ComposerSlots } from "../../lib/composer-slots";
import type { DayKey } from "../../lib/day-placement";
import {
  useKeepEditorDraft,
  useKeptEditorDraft,
} from "../../lib/editor-draft-context";
import {
  type ReminderDraftSnapshot,
  eventCreationDraftKeys,
  isDraftConflictError,
} from "../../lib/editor-draft-store";
import {
  formatDateTime,
  fromDateTimeInput,
  toDateTimeInput,
} from "../../lib/format";
import {
  type ContextCreateAttempt,
  useCreateReminder,
  useUpdateReminder,
} from "../../lib/queries";
import {
  quickReminderInstant,
  readReminderFields,
  type ReminderFields,
  reminderFieldsPayload,
} from "../../lib/reminder-fields";
import { useComposerCare, useComposerChips } from "../../lib/use-composer-care";
import { useEditorDraft } from "../../lib/use-editor-draft";
import { ConflictNotice } from "./conflict-notice";

type ReminderChip = "remindAt";

const nameLimit = 240;

/** The moment a reminder chosen without a time is due: nine in the morning. */
const defaultTime = "09:00";

/**
 * The composer for a reminder: the name, then Remind at as a chip opening
 * the date panel with the time unfolded. With a reminder it edits that
 * reminder in place and saves one versioned update; without one it adds
 * reminders, Enter adding and keeping the composer open for the next,
 * each due at nine on the row's day (the next nine for the list's row).
 * Its fields are a draft in the tab. More hands the fields to the full
 * editor.
 */
export function ReminderComposer({
  day = null,
  draftKey,
  eventId,
  now = new Date(),
  onMore,
  onRefresh,
  onSaved,
  reminder: latest,
  slotKey,
  slots,
}: {
  /** The day a new reminder starts due on: a day group's add row. */
  readonly day?: DayKey | null | undefined;
  /** The key a new reminder's draft is kept under, apart from the dialog's. */
  readonly draftKey?: string | undefined;
  readonly eventId: string;
  /** Today, for tests. */
  readonly now?: Date;
  /** Opens the full editor with the composer's fields. */
  readonly onMore: (fields: ReminderFields) => void;
  /** Reloads the list, so a stale save can be compared with the newest version. */
  readonly onRefresh: () => Promise<unknown>;
  /** A saved edit, for the list to announce. */
  readonly onSaved?: ((reminder: ReminderResponse) => void) | undefined;
  /** The reminder being edited; absent for a new one. */
  readonly reminder?: ReminderResponse | undefined;
  readonly slotKey: string;
  readonly slots: ComposerSlots;
}) {
  const t = useTranslations("composer");
  const rows = useTranslations("rows");
  const draftId =
    latest?.id ?? draftKey ?? eventCreationDraftKeys(eventId).reminder;
  const kept = useKeptEditorDraft(draftId);
  const [initial] = useState<ReminderDraftSnapshot | undefined>(() =>
    kept !== undefined && !kept.pending && kept.snapshot.kind === "reminder"
      ? kept.snapshot
      : undefined,
  );
  const fresh = useCallback(
    () => ({
      displayName: "",
      remindAt: toDateTimeInput(quickReminderInstant(day, now)),
    }),
    [day, now],
  );
  const initialize = useCallback(
    (source: ReminderResponse | undefined) =>
      source === undefined ? fresh() : readReminderFields(source),
    [fresh],
  );
  const draft = useEditorDraft(latest, initialize, initial);
  const reminder = draft.source;
  const adding = reminder === undefined;
  const [attempt] = useState<ContextCreateAttempt>(
    () => initial?.creationAttempt ?? { current: null },
  );
  const snapshot = useMemo<ReminderDraftSnapshot>(
    () => ({
      ...draft.snapshot,
      kind: "reminder",
      ...(adding ? { creationAttempt: attempt } : {}),
    }),
    [adding, attempt, draft.snapshot],
  );
  const close = useCallback(() => slots.close(slotKey), [slotKey, slots]);
  const recovery = useKeepEditorDraft(
    draftId,
    snapshot,
    draft.isDirty,
    close,
    reminder?.id ?? eventId,
  );
  const create = useCreateReminder(eventId, attempt);
  const update = useUpdateReminder();
  const mutation = adding ? create : update;
  const busy = mutation.isPending;
  const { fields } = draft;
  const [fieldError, setFieldError] = useState("");
  const [status, setStatus] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const chips = useComposerChips<ReminderChip>();
  const { submitOnceRebased } = useComposerCare({
    hasNewerVersion: draft.hasNewerVersion,
    isDirty: draft.isDirty,
    nameInput,
    onRefresh,
    slotKey,
    slots,
    stale: update.isError && isDraftConflictError(update.error),
    staleError: update.error,
  });
  const discard = () => {
    recovery.discard();
    close();
  };

  function submit() {
    if (busy || draft.hasNewerVersion || !recovery.isRetained) return;
    let input: ReturnType<typeof reminderFieldsPayload>;
    try {
      input = reminderFieldsPayload(fields, reminder);
      setFieldError("");
    } catch (error) {
      setFieldError(error instanceof Error ? error.message : t("keys"));
      return;
    }
    if (reminder === undefined) {
      void recovery.save(
        () => create.mutateAsync(input),
        () => {
          draft.change(fresh());
          setStatus(t("added"));
          nameInput.current?.focus();
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
        onSaved?.(saved);
        close();
      },
    );
  }

  const instant = fromDateTimeInput(fields.remindAt);
  const comparing = !adding && draft.hasNewerVersion;
  const notice = comparing ? (
    <ConflictNotice
      draft={draft}
      objectId={reminder.id}
      onKeepMine={() => {
        submitOnceRebased.current = true;
        update.reset();
        draft.rebase(draft.fields);
      }}
      onMerge={(merged) => {
        submitOnceRebased.current = true;
        update.reset();
        draft.rebase(merged);
      }}
      onTakeTheirs={() => {
        draft.loadLatest();
        update.reset();
      }}
    />
  ) : mutation.isError ? (
    <ErrorNotice error={mutation.error} />
  ) : null;
  const asked = slots.open === slotKey && slots.pending !== null;

  return (
    <Composer
      busy={busy}
      chips={
        <Chip
          buttonRef={chips.ref("remindAt")}
          clearLabel={t("clear", { field: t("remindAt") })}
          disabled={busy}
          icon={<BellIcon className="chip-icon" />}
          label={t("remindAt")}
          onClear={() => draft.change({ remindAt: "" })}
          onPress={() => chips.toggle("remindAt")}
          open={chips.openChip === "remindAt"}
          value={instant === null ? "" : formatDateTime(instant)}
        >
          {chips.openChip === "remindAt" ? (
            <DatePanel
              disabled={busy}
              kind="day"
              label={t("remindAt")}
              now={now}
              onChange={(next) =>
                draft.change({
                  remindAt:
                    next.day === ""
                      ? ""
                      : `${next.day}T${next.time === "" ? defaultTime : next.time}`,
                })
              }
              onClose={chips.close("remindAt")}
              timeOpen
              timeRequired
              value={{
                day: fields.remindAt.slice(0, 10),
                time: fields.remindAt.slice(11, 16),
              }}
            />
          ) : null}
        </Chip>
      }
      error={fieldError}
      label={
        adding ? t("newReminder") : rows("edit", { name: reminder.displayName })
      }
      more={{
        label: t("moreRecordLabel"),
        onOpen: () => {
          const current = fields;
          discard();
          onMore(current);
        },
      }}
      name={{
        label: t("reminderName"),
        limit: nameLimit,
        onChange: (displayName) => {
          setStatus("");
          draft.change({ displayName });
        },
        placeholder: t("reminderName"),
        value: fields.displayName,
      }}
      nameRef={nameInput}
      notice={notice}
      onCancel={discard}
      onEscape={discard}
      onSubmit={submit}
      question={
        asked
          ? {
              text: t("unsaved"),
              onDiscard: () => {
                recovery.discard();
                slots.answer(slotKey, true);
              },
              onKeep: () => slots.answer(slotKey, false),
            }
          : undefined
      }
      status={status}
      submitDisabled={
        fields.displayName.trim() === "" ||
        draft.hasNewerVersion ||
        !recovery.isRetained
      }
      submitLabel={adding ? t("addReminder") : t("save")}
    />
  );
}
