"use client";

import type { EventResponse } from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Chip, ChipPanel } from "../../components/chip";
import { Composer } from "../../components/composer";
import { CountedField } from "../../components/counted-field";
import { DatePanel, type SpanValue } from "../../components/date-panel";
import { ErrorNotice } from "../../components/feedback";
import { CalendarIcon, PinIcon } from "../../components/icons";
import { shownTimeZone } from "../../i18n/active-preferences";
import { describeCalendarRange } from "../../lib/calendar-range";
import type { ComposerSlots } from "../../lib/composer-slots";
import { descriptionPayload } from "../../lib/description-field";
import {
  useKeepEditorDraft,
  useKeptEditorDraft,
} from "../../lib/editor-draft-context";
import {
  type EventDraftSnapshot,
  type EventFields,
  eventCreationDraftKeys,
  isDraftConflictError,
  readEventFields,
} from "../../lib/editor-draft-store";
import { eventSchedulePayload } from "../../lib/event-schedule";
import {
  formatDateTime,
  formatTime,
  fromDateTimeInput,
} from "../../lib/format";
import { locationLimit, locationPayload } from "../../lib/location-field";
import {
  type ContextCreateAttempt,
  useCreateScheduledEvent,
  useUpdateEvent,
} from "../../lib/queries";
import { useComposerCare, useComposerChips } from "../../lib/use-composer-care";
import { useEditorDraft } from "../../lib/use-editor-draft";
import { ConflictNotice, type FieldFormatter } from "./conflict-notice";
import { scheduleChange } from "./schedule-rows";

type ScheduleChip = "dates" | "place";

const nameLimit = 240;

/** The dates chip's value: the span, with the times when the item is timed. */
export function describeSchedule(fields: EventFields): string {
  if (fields.mode === "unscheduled" || fields.startDate === "") return "";
  if (fields.mode !== "timed" || fields.startTime === "")
    return describeCalendarRange({
      startDate: fields.startDate,
      endDate: fields.endDate,
    });
  const endDate = fields.endDate || fields.startDate;
  const start = formatDateTime(
    fromDateTimeInput(`${fields.startDate}T${fields.startTime}`),
  );
  if (fields.endTime === "") return start;
  const end = fromDateTimeInput(`${endDate}T${fields.endTime}`);
  return `${start} to ${
    endDate === fields.startDate ? formatTime(end ?? "") : formatDateTime(end)
  }`;
}

/**
 * The composer for a schedule item: the name and description, then Dates
 * (the date panel as a span, its times at the foot) and Place as chips.
 * With an item it edits that item in place and saves one versioned
 * update; without one it adds items to the event's schedule, Enter adding
 * and keeping the composer open for the next. Its fields are a draft in
 * the tab, so an unsaved composer left behind is found again. More hands
 * the fields to the full editor.
 */
export function ScheduleComposer({
  draftKey,
  eventId,
  item: latest,
  now = new Date(),
  onMore,
  onRefresh,
  onSaved,
  slotKey,
  slots,
}: {
  /** The key a new item's draft is kept under, apart from the dialog's. */
  readonly draftKey?: string | undefined;
  readonly eventId: string;
  /** The schedule item being edited; absent for a new one. */
  readonly item?: EventResponse | undefined;
  /** Today, for tests. */
  readonly now?: Date;
  /** Opens the full editor with the composer's fields. */
  readonly onMore: (fields: EventFields) => void;
  /** Reloads the list, so a stale save can be compared with the newest version. */
  readonly onRefresh: () => Promise<unknown>;
  /** A saved edit, for the list to announce. */
  readonly onSaved?: ((item: EventResponse) => void) | undefined;
  readonly slotKey: string;
  readonly slots: ComposerSlots;
}) {
  const t = useTranslations("composer");
  const rows = useTranslations("rows");
  const modes = useTranslations("conflict.modes");
  const draftId =
    latest?.id ?? draftKey ?? eventCreationDraftKeys(eventId).schedule;
  const kept = useKeptEditorDraft(draftId);
  const [initial] = useState<EventDraftSnapshot | undefined>(() =>
    kept !== undefined && !kept.pending && kept.snapshot.kind === "event"
      ? kept.snapshot
      : undefined,
  );
  const draft = useEditorDraft(latest, readEventFields, initial);
  const item = draft.source;
  const adding = item === undefined;
  const [attempt] = useState<ContextCreateAttempt>(
    () => initial?.creationAttempt ?? { current: null },
  );
  const snapshot = useMemo<EventDraftSnapshot>(
    () => ({
      ...draft.snapshot,
      kind: "event",
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
    item?.id ?? eventId,
  );
  const create = useCreateScheduledEvent(eventId, attempt);
  const update = useUpdateEvent();
  const mutation = adding ? create : update;
  const busy = mutation.isPending;
  const { fields } = draft;
  const [fieldError, setFieldError] = useState("");
  const [status, setStatus] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const placeInput = useRef<HTMLInputElement>(null);
  const chips = useComposerChips<ScheduleChip>();
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
  // The place's field takes focus as its panel opens.
  useEffect(() => {
    if (chips.openChip === "place") placeInput.current?.focus();
  }, [chips.openChip]);
  const formatEventField: FieldFormatter = (key, value) => {
    const mode = value as Parameters<typeof modes>[0];
    return key === "mode" && modes.has(mode) ? modes(mode) : undefined;
  };
  const discard = () => {
    recovery.discard();
    close();
  };

  function submit() {
    if (busy || draft.hasNewerVersion || !recovery.isRetained) return;
    let schedule: ReturnType<typeof eventSchedulePayload>;
    let location: string | null;
    let description: string | null;
    try {
      schedule = eventSchedulePayload(fields);
      location = locationPayload(fields.location);
      description = descriptionPayload(fields.description);
      setFieldError("");
    } catch (error) {
      setFieldError(error instanceof Error ? error.message : t("keys"));
      return;
    }
    if (item === undefined) {
      void recovery.save(
        () =>
          create.mutateAsync({
            displayName: fields.displayName,
            ...schedule,
            isAllDay: false,
            timezone: shownTimeZone(),
            location,
            description,
          }),
        () => {
          draft.change(readEventFields());
          setStatus(t("added"));
          nameInput.current?.focus();
        },
      );
      return;
    }
    void recovery.save(
      () =>
        update.mutateAsync({
          id: item.id,
          input: {
            displayName: fields.displayName,
            description,
            ...schedule,
            location,
            expectedVersion: item.version,
            isAllDay: fields.mode === "timed" && item.isAllDay,
            timezone: item.timezone,
          },
        }),
      (saved) => {
        draft.accept(saved);
        onSaved?.(saved);
        close();
      },
    );
  }

  const span: SpanValue = {
    startDate: fields.mode === "unscheduled" ? "" : fields.startDate,
    endDate: fields.mode === "unscheduled" ? "" : fields.endDate,
    startTime: fields.mode === "timed" ? fields.startTime : "",
    endTime: fields.mode === "timed" ? fields.endTime : "",
  };
  const comparing = !adding && draft.hasNewerVersion;
  const notice = comparing ? (
    <ConflictNotice
      draft={draft}
      format={formatEventField}
      objectId={item.id}
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
        <>
          <Chip
            buttonRef={chips.ref("dates")}
            clearLabel={t("clear", { field: t("dates") })}
            disabled={busy}
            icon={<CalendarIcon className="chip-icon" />}
            label={t("dates")}
            onClear={() =>
              draft.change(
                scheduleChange({
                  startDate: "",
                  endDate: "",
                  startTime: "",
                  endTime: "",
                }),
              )
            }
            onPress={() => chips.toggle("dates")}
            open={chips.openChip === "dates"}
            value={describeSchedule(fields)}
          >
            {chips.openChip === "dates" ? (
              <DatePanel
                disabled={busy}
                kind="span"
                label={t("dates")}
                now={now}
                onChange={(next) => draft.change(scheduleChange(next))}
                onClose={chips.close("dates")}
                value={span}
              />
            ) : null}
          </Chip>
          <Chip
            buttonRef={chips.ref("place")}
            clearLabel={t("clear", { field: t("place") })}
            disabled={busy}
            icon={<PinIcon className="chip-icon" />}
            label={t("place")}
            onClear={() => draft.change({ location: "" })}
            onPress={() => chips.toggle("place")}
            open={chips.openChip === "place"}
            value={fields.location}
          >
            {chips.openChip === "place" ? (
              <ChipPanel label={t("place")} onClose={chips.close("place")}>
                <CountedField
                  className="chip-field"
                  disabled={busy}
                  hideLabel
                  inputRef={placeInput}
                  label={t("place")}
                  limit={locationLimit}
                  onChange={(location) => draft.change({ location })}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    chips.close("place")(true);
                  }}
                  placeholder={t("locationPlaceholder")}
                  value={fields.location}
                />
              </ChipPanel>
            ) : null}
          </Chip>
        </>
      }
      description={{
        onChange: (description) => draft.change({ description }),
        value: fields.description,
      }}
      error={fieldError}
      label={
        adding ? t("newScheduleItem") : rows("edit", { name: item.displayName })
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
        label: t("scheduleName"),
        limit: nameLimit,
        onChange: (displayName) => {
          setStatus("");
          draft.change({ displayName });
        },
        placeholder: t("scheduleName"),
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
      submitLabel={adding ? t("addScheduleItem") : t("save")}
    />
  );
}
