"use client";

import type { TaskResponse } from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Chip, ChipPanel } from "../../components/chip";
import { Composer } from "../../components/composer";
import { CountedField } from "../../components/counted-field";
import { DatePanel } from "../../components/date-panel";
import { describeDue } from "../../components/due-row";
import { ErrorNotice } from "../../components/feedback";
import {
  CalendarIcon,
  PinIcon,
  TagIcon,
  UserIcon,
} from "../../components/icons";
import type { ComposerSlots } from "../../lib/composer-slots";
import { dayKeyOf } from "../../lib/day-placement";
import {
  useKeepEditorDraft,
  useKeptEditorDraft,
} from "../../lib/editor-draft-context";
import {
  isDraftConflictError,
  type TaskDraftSnapshot,
} from "../../lib/editor-draft-store";
import {
  type ContextCreateAttempt,
  useCreateTask,
  useLabelsQuery,
  usePersonsQuery,
  useUpdateTask,
} from "../../lib/queries";
import {
  emptyTaskFields,
  locationLimit,
  readTaskFields,
  setTaskFields,
  splitLabelIds,
  type TaskFields,
  taskFieldsPayload,
} from "../../lib/task-fields";
import { useEditorDraft } from "../../lib/use-editor-draft";
import { ConflictNotice, type FieldFormatter } from "../events/conflict-notice";
import { AssigneeChoices } from "./assignee-picker";
import { LabelChoices } from "./label-picker";

/** The chips of a task, one per field the composer carries. */
type TaskChip = "due" | "assignee" | "labels" | "location";

const nameLimit = 240;

/** A draft for a task outside any Event is keyed like a new Event's. */
export const standaloneTaskDraftId = "task:new";

/**
 * The draft key of a task row's composer. The composer keeps its drafts
 * apart from the dialog's: the dialog owns a save in flight and a save
 * whose answer was lost (retried with the same command), which its
 * recovery surfaces carry and the composer has no place for.
 */
export const taskComposerDraftId = (taskId: string) => `composer:${taskId}`;

/**
 * The composer for a task: the name and description, then Due (the date
 * panel with Time and Repeat), Assignee, Labels, and Location as chips.
 * With a task it edits that task in place and saves one versioned update;
 * without one it adds tasks, Enter adding and keeping the composer open
 * for the next. Its fields are a draft in the tab under `draftId`, so an
 * unsaved composer left behind is found open again. More hands the set
 * fields to the full editor, whose own drafts stay its own.
 */
export function TaskComposer({
  dueOn = null,
  draftId,
  eventId,
  now = new Date(),
  onMore,
  onRefresh,
  onSaved,
  sectionId,
  slotKey,
  slots,
  task: latest,
}: {
  /** The day a new task starts due on: a day group's add row. */
  readonly dueOn?: string | null | undefined;
  readonly draftId: string;
  readonly eventId?: string | undefined;
  /** Today, for tests. */
  readonly now?: Date;
  /** Opens the full editor with the composer's fields. */
  readonly onMore: (fields: Partial<TaskFields>) => void;
  /** Reloads the list, so a stale save can be compared with the newest version. */
  readonly onRefresh: () => Promise<unknown>;
  /** A saved edit, for the list to announce. */
  readonly onSaved?: ((task: TaskResponse) => void) | undefined;
  /**
   * The section a new task starts in, null for none, when the list has
   * sections; absent where it has none, so the field is left out.
   */
  readonly sectionId?: string | null | undefined;
  readonly slotKey: string;
  readonly slots: ComposerSlots;
  /** The task being edited; absent for a new one. */
  readonly task?: TaskResponse | undefined;
}) {
  const t = useTranslations("composer");
  const rows = useTranslations("rows");
  const assigneeT = useTranslations("assignee");
  const kept = useKeptEditorDraft(draftId);
  // A draft left behind in the tab is taken up as it was; a fresh add
  // starts with the row's day set.
  const [initial] = useState<TaskDraftSnapshot | undefined>(() =>
    kept !== undefined && !kept.pending && kept.snapshot.kind === "task"
      ? kept.snapshot
      : undefined,
  );
  // A fresh add starts with the row's day and section set; the section
  // is a field only where the list has sections, as the dialog's is.
  const fresh = useMemo<TaskFields>(
    () => ({
      ...emptyTaskFields,
      dueDate: dueOn ?? "",
      ...(sectionId === undefined ? {} : { section: sectionId ?? "" }),
    }),
    [dueOn, sectionId],
  );
  const initialize = useCallback(
    (source: TaskResponse | undefined) =>
      source === undefined ? fresh : readTaskFields(source),
    [fresh],
  );
  const draft = useEditorDraft(latest, initialize, initial);
  const task = draft.source;
  const adding = task === undefined;
  const [attempt] = useState<ContextCreateAttempt>(
    () => initial?.creationAttempt ?? { current: null },
  );
  const snapshot = useMemo<TaskDraftSnapshot>(
    () => ({
      ...draft.snapshot,
      kind: "task",
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
    task?.id ?? eventId ?? "new",
  );
  const create = useCreateTask(eventId, attempt);
  const update = useUpdateTask();
  const mutation = adding ? create : update;
  const busy = mutation.isPending;
  const { fields } = draft;
  const [fieldError, setFieldError] = useState("");
  const [status, setStatus] = useState("");
  const [openChip, setOpenChip] = useState<TaskChip | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const chipButtons = useRef<Partial<Record<TaskChip, HTMLButtonElement>>>({});
  const locationInput = useRef<HTMLInputElement>(null);

  // The open composer tells the list whether it holds unsaved changes, so
  // opening another row asks first.
  const { isDirty } = draft;
  useEffect(() => {
    slots.setDirty(slotKey, isDirty);
  }, [isDirty, slotKey, slots]);
  // The name takes focus as the composer opens, the caret after its text.
  useEffect(() => {
    const input = nameInput.current;
    if (input === null) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);
  useEffect(() => {
    if (openChip === "location") locationInput.current?.focus();
  }, [openChip]);

  // A save refused as stale reads the newest version at once, so the
  // comparison appears in place of the refusal.
  const stale = update.isError && isDraftConflictError(update.error);
  const refreshedFor = useRef<unknown>(null);
  useEffect(() => {
    if (!stale || refreshedFor.current === update.error) return;
    refreshedFor.current = update.error;
    void onRefresh();
  }, [onRefresh, stale, update.error]);
  // Keep mine and Save merged version pin the draft to the newest version,
  // then submit the composer as the person would.
  const submitOnceRebased = useRef(false);
  useEffect(() => {
    if (!submitOnceRebased.current || draft.hasNewerVersion) return;
    submitOnceRebased.current = false;
    nameInput.current?.form?.requestSubmit();
  }, [draft.hasNewerVersion]);

  // The comparison names labels and the assignee rather than showing ids.
  const labelNames = useLabelsQuery(
    openChip === "labels" || fields.labels !== "" || draft.hasNewerVersion,
  ).data?.names;
  const persons = usePersonsQuery(
    openChip === "assignee" || fields.assignee !== "" || draft.hasNewerVersion,
  );
  const formatTaskField: FieldFormatter = (key, value) => {
    if (value === "") return undefined;
    if (key === "labels")
      return splitLabelIds(value)
        .map((labelId) => labelNames?.get(labelId) ?? labelId)
        .join(", ");
    if (key === "assignee") return persons.data?.names.get(value);
    return undefined;
  };

  const discard = () => {
    recovery.discard();
    close();
  };
  const closeChip = (chip: TaskChip) => (byKeyboard: boolean) => {
    setOpenChip((current) => (current === chip ? null : current));
    if (byKeyboard) chipButtons.current[chip]?.focus();
  };
  const toggleChip = (chip: TaskChip) =>
    setOpenChip((current) => (current === chip ? null : chip));
  const chipRef = (chip: TaskChip) => (element: HTMLButtonElement | null) => {
    if (element === null) delete chipButtons.current[chip];
    else chipButtons.current[chip] = element;
  };

  function submit() {
    if (busy || draft.hasNewerVersion || !recovery.isRetained) return;
    let input: ReturnType<typeof taskFieldsPayload>;
    try {
      input = taskFieldsPayload(fields, task);
      setFieldError("");
    } catch (error) {
      setFieldError(error instanceof Error ? error.message : t("keys"));
      return;
    }
    if (task === undefined) {
      void recovery.save(
        () => create.mutateAsync(input),
        () => {
          draft.change(fresh);
          setStatus(t("added"));
          nameInput.current?.focus();
        },
      );
      return;
    }
    void recovery.save(
      () =>
        update.mutateAsync({
          id: task.id,
          input: { ...input, expectedVersion: task.version },
        }),
      (saved) => {
        draft.accept(saved);
        onSaved?.(saved);
        close();
      },
    );
  }

  const today = dayKeyOf(now);
  const dueValue =
    fields.dueDate === ""
      ? ""
      : describeDue(
          fields.dueDate,
          fields.dueTime,
          now,
          fields.repeat,
          fields.repeatUntil,
        );
  const assigneeValue =
    fields.assignee === ""
      ? ""
      : (persons.data?.names.get(fields.assignee) ?? assigneeT("assigned"));
  const labelIds = splitLabelIds(fields.labels);
  const named = labelIds.flatMap((id) => {
    const name = labelNames?.get(id);
    return name === undefined ? [] : [name];
  });
  const labelsValue =
    labelIds.length === 0
      ? ""
      : named.length === labelIds.length
        ? named.join(", ")
        : String(labelIds.length);
  const comparing = !adding && draft.hasNewerVersion;
  const notice = comparing ? (
    <ConflictNotice
      draft={draft}
      format={formatTaskField}
      objectId={task.id}
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
            buttonRef={chipRef("due")}
            clearLabel={t("clear", { field: t("due") })}
            disabled={busy}
            icon={<CalendarIcon className="chip-icon" />}
            label={t("due")}
            onClear={() =>
              draft.change({
                dueDate: "",
                dueTime: "",
                duration: "",
                repeat: "",
                repeatUntil: "",
              })
            }
            onPress={() => toggleChip("due")}
            open={openChip === "due"}
            tone={fields.dueDate === today ? "is-today" : ""}
            value={dueValue}
          >
            {openChip === "due" ? (
              <DatePanel
                disabled={busy}
                kind="day"
                label={t("due")}
                now={now}
                onChange={(value) =>
                  draft.change({
                    dueDate: value.day,
                    dueTime: value.time,
                    // A duration needs a time to run from; an end before
                    // the new date would be refused, so it goes.
                    duration: value.time === "" ? "" : fields.duration,
                    repeat: value.day === "" ? "" : fields.repeat,
                    repeatUntil:
                      value.day === "" ||
                      (fields.repeatUntil !== "" &&
                        fields.repeatUntil < value.day)
                        ? ""
                        : fields.repeatUntil,
                  })
                }
                onClose={closeChip("due")}
                onRepeatChange={(rule) =>
                  draft.change({ repeat: rule.rule, repeatUntil: rule.until })
                }
                repeat={{ rule: fields.repeat, until: fields.repeatUntil }}
                value={{ day: fields.dueDate, time: fields.dueTime }}
              />
            ) : null}
          </Chip>
          <Chip
            buttonRef={chipRef("assignee")}
            clearLabel={t("clear", { field: t("assignee") })}
            disabled={busy}
            icon={<UserIcon className="chip-icon" />}
            label={t("assignee")}
            onClear={() => draft.change({ assignee: "" })}
            onPress={() => toggleChip("assignee")}
            open={openChip === "assignee"}
            value={assigneeValue}
          >
            {openChip === "assignee" ? (
              <ChipPanel label={t("assignee")} onClose={closeChip("assignee")}>
                <AssigneeChoices
                  disabled={busy}
                  onChange={(assignee) => draft.change({ assignee })}
                  persons={persons}
                  value={fields.assignee}
                />
              </ChipPanel>
            ) : null}
          </Chip>
          <Chip
            buttonRef={chipRef("labels")}
            clearLabel={t("clear", { field: t("labels") })}
            disabled={busy}
            icon={<TagIcon className="chip-icon" />}
            label={t("labels")}
            onClear={() => draft.change({ labels: "" })}
            onPress={() => toggleChip("labels")}
            open={openChip === "labels"}
            value={labelsValue}
          >
            {openChip === "labels" ? (
              <ChipPanel label={t("labels")} onClose={closeChip("labels")}>
                <LabelChoices
                  disabled={busy}
                  onChange={(labels) => draft.change({ labels })}
                  value={fields.labels}
                />
              </ChipPanel>
            ) : null}
          </Chip>
          <Chip
            buttonRef={chipRef("location")}
            clearLabel={t("clear", { field: t("location") })}
            disabled={busy}
            icon={<PinIcon className="chip-icon" />}
            label={t("location")}
            onClear={() => draft.change({ location: "" })}
            onPress={() => toggleChip("location")}
            open={openChip === "location"}
            value={fields.location}
          >
            {openChip === "location" ? (
              <ChipPanel label={t("location")} onClose={closeChip("location")}>
                <CountedField
                  className="chip-field"
                  disabled={busy}
                  hideLabel
                  inputRef={locationInput}
                  label={t("location")}
                  limit={locationLimit}
                  onChange={(location) => draft.change({ location })}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    closeChip("location")(true);
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
      label={adding ? t("newTask") : rows("edit", { name: task.displayName })}
      more={{
        label: t("moreLabel"),
        onOpen: () => {
          const current = fields;
          discard();
          onMore(setTaskFields(current));
        },
      }}
      name={{
        label: t("taskName"),
        limit: nameLimit,
        onChange: (displayName) => {
          setStatus("");
          draft.change({ displayName });
        },
        placeholder: t("taskName"),
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
      submitLabel={adding ? t("addTask") : t("save")}
    />
  );
}
