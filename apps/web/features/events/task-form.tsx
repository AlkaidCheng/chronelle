"use client";

import type {
  AccessSource,
  SectionResponse,
  TaskResponse,
} from "@livtales/schemas";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AccessLine } from "../../components/access-line";
import { CountedField } from "../../components/counted-field";
import { DescriptionField } from "../../components/description-field";
import { EditorForm } from "../../components/editor-form";
import {
  DiscardActions,
  EditorDialogHeader,
} from "../../components/editor-dialog-controls";
import type { FieldFormatter } from "./conflict-notice";
import { EditorControls, useConflictSlot } from "./editor-controls";
import {
  locationLimit,
  readTaskFields,
  splitLabelIds,
  type TaskFields,
  taskFieldsPayload,
} from "../../lib/task-fields";
import {
  eventCreationDraftKeys,
  type TaskDraftSnapshot,
} from "../../lib/editor-draft-store";
import { useKeepEditorDraft } from "../../lib/editor-draft-context";
import {
  EditorDraftRecovery,
  EditorDraftStatus,
} from "./editor-draft-recovery";
import { useDialogHelp } from "../../lib/use-dialog-help";
import { usePlanningEditorDialog } from "../../lib/use-planning-editor-dialog";
import { useOpenHistory } from "../history/history-provider";
import { DueRow } from "../../components/due-row";
import { durationChoices } from "../../lib/due-choices";
import { formatDuration } from "../../lib/format";
import { AssigneePicker } from "../tasks/assignee-picker";
import { LabelPicker } from "../tasks/label-picker";
import { SectionField } from "../sections/section-field";
import { useEditorDraft } from "../../lib/use-editor-draft";
import {
  type ContextCreateAttempt,
  useCreateTask,
  useLabelsQuery,
  usePersonsQuery,
  useRefreshEvent,
  useUpdateTask,
} from "../../lib/queries";

/** The task a new subtask belongs to; it shares that task's permission scope. */
export interface SubtaskParent {
  readonly id: string;
  readonly displayName: string;
  readonly permissionScopeId: string;
}

interface TaskFormProps {
  /** Where the caller's access to an existing task comes from, named under the fields when indirect. */
  readonly accessSource?: AccessSource | undefined;
  /** The Event a new task joins; absent, the task is created on its own. */
  readonly eventId?: string | undefined;
  readonly onCancel?: (() => void) | undefined;
  readonly onRefresh?: (() => Promise<void>) | undefined;
  /** Makes a new task a subtask of this one. */
  readonly parent?: SubtaskParent | undefined;
  /** The sections of the Event's To-dos, which the editor offers as the task's section. */
  readonly sections?: readonly SectionResponse[] | undefined;
  /** The fields the editor starts with when a composer hands over to it. */
  readonly start?: Partial<TaskFields> | undefined;
  readonly task?: TaskResponse | undefined;
}

// A draft for a task outside any Event is keyed like a new Event's: its
// recovery checks the session rather than a parent's access.
const standaloneTaskDraft = { id: "task:new", accessId: "new" };

export function TaskForm(props: TaskFormProps) {
  const draftId =
    props.task?.id ??
    (props.parent !== undefined
      ? `task:sub:${props.parent.id}`
      : props.eventId === undefined
        ? standaloneTaskDraft.id
        : eventCreationDraftKeys(props.eventId).task);
  return (
    <EditorDraftRecovery
      kind="task"
      id={draftId}
      accessId={props.task?.id ?? props.eventId ?? standaloneTaskDraft.accessId}
      onClose={() => props.onCancel?.()}
    >
      {(initialDraft) => (
        <TaskEditor {...props} draftId={draftId} initialDraft={initialDraft} />
      )}
    </EditorDraftRecovery>
  );
}

function TaskEditor({
  accessSource,
  eventId,
  draftId,
  initialDraft,
  onCancel,
  onRefresh,
  parent,
  sections,
  start,
  task: latestTask,
}: TaskFormProps & {
  readonly draftId: string;
  readonly initialDraft: TaskDraftSnapshot | undefined;
}) {
  const conflictSlot = useConflictSlot();
  const draft = useEditorDraft(latestTask, readTaskFields, initialDraft);
  const task = draft.source;
  // A composer's fields seed a fresh draft once; a recovered draft keeps
  // what it had.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || start === undefined || initialDraft !== undefined)
      return;
    seeded.current = true;
    draft.change(start);
  }, [draft, initialDraft, start]);
  const [attempt] = useState<ContextCreateAttempt>(
    () => initialDraft?.creationAttempt ?? { current: null },
  );
  const snapshot = useMemo<TaskDraftSnapshot>(
    () => ({
      ...draft.snapshot,
      kind: "task",
      ...(task === undefined ? { creationAttempt: attempt } : {}),
    }),
    [draft.snapshot, task, attempt],
  );
  const recovery = useKeepEditorDraft(
    draftId,
    snapshot,
    draft.isDirty,
    () => onCancel?.(),
    task?.id ?? eventId ?? standaloneTaskDraft.accessId,
  );
  const create = useCreateTask(eventId, attempt);
  const update = useUpdateTask();
  const refresh = useRefreshEvent(eventId, { throwOnError: true });
  const {
    displayName,
    dueDate,
    dueTime,
    duration,
    repeat,
    repeatUntil,
    assignee,
    location,
    description,
    labels,
    section,
  } = draft.fields;
  const mutation = task === undefined ? create : update;
  // The comparison names labels and the assignee rather than showing ids;
  // the lists load only once there is a newer version to compare.
  const labelNames = useLabelsQuery(draft.hasNewerVersion).data?.names;
  const people = usePersonsQuery(draft.hasNewerVersion).data?.items;
  const formatTaskField: FieldFormatter = (key, value) => {
    if (value === "") return undefined;
    if (key === "labels")
      return splitLabelIds(value)
        .map((labelId) => labelNames?.get(labelId) ?? labelId)
        .join(", ");
    if (key === "assignee")
      return people?.find((person) => person.id === value)?.displayName;
    return undefined;
  };
  const t = useTranslations("taskForm");
  const dueField = useTranslations("dueField");
  const editor = useTranslations("editor");
  const [fieldError, setFieldError] = useState("");
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
  const help = useDialogHelp("task");

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (
      isConfirming ||
      draft.hasNewerVersion ||
      mutation.isPending ||
      !recovery.isRetained
    )
      return;
    let input: ReturnType<typeof taskFieldsPayload>;
    try {
      input = taskFieldsPayload(draft.fields, task);
      setFieldError("");
    } catch (error) {
      setFieldError(
        error instanceof Error ? error.message : editor("checkFields"),
      );
      return;
    }
    rememberSubmit(formEvent.currentTarget);
    if (task === undefined) {
      // A subtask names its parent and, outside an Event, takes the parent's
      // scope; inside one the Event's scope is applied by the server.
      const creation =
        parent === undefined
          ? input
          : {
              ...input,
              parentTaskId: parent.id,
              ...(eventId === undefined
                ? { permissionScopeId: parent.permissionScopeId }
                : {}),
            };
      void recovery.save(
        () => create.mutateAsync(creation),
        () => {
          draft.change({
            displayName: "",
            dueDate: "",
            dueTime: "",
            duration: "",
            repeat: "",
            repeatUntil: "",
            assignee: "",
            location: "",
            description: "",
            labels: "",
            section: "",
          });
          onCancel?.();
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
            : task
              ? t("editTitle")
              : parent
                ? t("addSubtaskTitle")
                : t("addTitle")
        }
        closeLabel={t("close")}
        isConfirming={isConfirming}
        isPending={mutation.isPending}
        onClose={requestClose}
        help={help}
      >
        {task && (
          <button
            hidden={isConfirming}
            className="button button-quiet button-small"
            type="button"
            aria-label={t("viewHistory")}
            disabled={mutation.isPending}
            onClick={() =>
              openHistory({ objectId: task.id, displayName: task.displayName })
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
          setFieldError("");
          if (mutation.isSuccess) mutation.reset();
        }}
        onSubmit={handleSubmit}
      >
        <div className="event-create-body event-inspector-fields">
          <div className="editor-conflict-slot" ref={conflictSlot.ref} />
          {task === undefined ? null : <AccessLine source={accessSource} />}
          {parent && task === undefined ? (
            <p className="field-hint field-wide">
              {t("subtaskOf", { parent: parent.displayName })}
            </p>
          ) : null}
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
          <DescriptionField
            disabled={mutation.isPending}
            onChange={(description) => draft.change({ description })}
            value={description}
          />
          <DueRow
            disabled={mutation.isPending}
            dueDate={dueDate}
            dueTime={dueTime}
            onChange={(due) =>
              draft.change({
                ...due,
                // A duration needs a time to run from.
                duration: due.dueTime === "" ? "" : duration,
              })
            }
            repeat={repeat}
            repeatUntil={repeatUntil}
          />
          <label className="field">
            <span id={`${headingId}-duration`}>{dueField("duration")}</span>
            <select
              aria-labelledby={`${headingId}-duration`}
              disabled={mutation.isPending || dueTime === ""}
              onChange={(input) =>
                draft.change({ duration: input.target.value })
              }
              value={duration}
            >
              <option value="">{dueField("noDuration")}</option>
              {durationChoices.map((minutes) => (
                <option key={minutes} value={String(minutes)}>
                  {formatDuration(minutes)}
                </option>
              ))}
            </select>
          </label>
          <CountedField
            className="field-wide"
            disabled={mutation.isPending}
            label={t("location")}
            limit={locationLimit}
            onChange={(location) => draft.change({ location })}
            placeholder={t("locationPlaceholder")}
            value={location}
          />
          {fieldError && <p role="alert">{fieldError}</p>}
          <AssigneePicker
            disabled={mutation.isPending}
            onChange={(assignee) => draft.change({ assignee })}
            value={assignee}
          />
          <LabelPicker
            disabled={mutation.isPending}
            onChange={(labels) => draft.change({ labels })}
            value={labels}
          />
          {sections === undefined ? null : (
            <SectionField
              disabled={mutation.isPending}
              onChange={(section) => draft.change({ section })}
              sections={sections}
              value={section ?? ""}
            />
          )}
        </div>
        <footer className="event-inspector-footer">
          <EditorControls
            conflict={
              task === undefined
                ? undefined
                : {
                    objectId: task.id,
                    format: formatTaskField,
                    slot: conflictSlot.slot,
                  }
            }
            disabled={!recovery.isRetained}
            draft={draft}
            mutation={mutation}
            onCancel={requestClose}
            onRefresh={task === undefined ? undefined : (onRefresh ?? refresh)}
            submitLabel={task === undefined ? t("create") : t("save")}
          />
          <EditorDraftStatus
            {...recovery}
            failureMessage={
              task === undefined
                ? editor("failureRetry")
                : editor("failureRefresh")
            }
          />
        </footer>
      </EditorForm>
    </dialog>
  );
}
