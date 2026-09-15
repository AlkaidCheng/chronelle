"use client";

import type { TaskResponse } from "@chronelle/schemas";
import { type FormEvent, useMemo, useState } from "react";
import { EditorForm } from "../../components/editor-form";
import {
  DiscardActions,
  EditorDialogHeader,
} from "../../components/editor-dialog-controls";
import { EditorControls } from "./editor-controls";
import { readTaskFields, taskFieldsPayload } from "../../lib/task-fields";
import {
  eventCreationDraftKeys,
  type TaskDraftSnapshot,
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
  useCreateTask,
  useRefreshEvent,
  useUpdateTask,
  type ContextCreateAttempt,
} from "../../lib/queries";

/** The task a new subtask belongs to; it shares that task's permission scope. */
export interface SubtaskParent {
  readonly id: string;
  readonly displayName: string;
  readonly permissionScopeId: string;
}

interface TaskFormProps {
  /** The Event a new task joins; absent, the task is created on its own. */
  readonly eventId?: string | undefined;
  readonly onCancel?: (() => void) | undefined;
  readonly onRefresh?: (() => Promise<void>) | undefined;
  /** Makes a new task a subtask of this one. */
  readonly parent?: SubtaskParent | undefined;
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
  eventId,
  draftId,
  initialDraft,
  onCancel,
  onRefresh,
  parent,
  task: latestTask,
}: TaskFormProps & {
  readonly draftId: string;
  readonly initialDraft: TaskDraftSnapshot | undefined;
}) {
  const draft = useEditorDraft(latestTask, readTaskFields, initialDraft);
  const task = draft.source;
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
  const { displayName, dueDate, dueTime } = draft.fields;
  const mutation = task === undefined ? create : update;
  const [dueError, setDueError] = useState("");
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
    let input: ReturnType<typeof taskFieldsPayload>;
    try {
      input = taskFieldsPayload(draft.fields, task);
      setDueError("");
    } catch (error) {
      setDueError(
        error instanceof Error ? error.message : "Check the due time.",
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
          draft.change({ displayName: "", dueDate: "", dueTime: "" });
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
      className={`event-create-dialog${task ? " event-inspector" : ""}`}
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
            ? "Discard task changes?"
            : task
              ? "Edit task"
              : parent
                ? "Add subtask"
                : "Add task"
        }
        closeLabel="Close task editor"
        isConfirming={isConfirming}
        isPending={mutation.isPending}
        onClose={requestClose}
      >
        {task && (
          <button
            hidden={isConfirming}
            className="button button-quiet button-small"
            type="button"
            aria-label="View task history"
            disabled={mutation.isPending}
            onClick={() =>
              openHistory({ objectId: task.id, displayName: task.displayName })
            }
          >
            History
          </button>
        )}
      </EditorDialogHeader>
      {isConfirming && (
        <div className="event-create-body">
          <p>Your task changes have not been saved.</p>
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
          setDueError("");
          if (mutation.isSuccess) mutation.reset();
        }}
        onSubmit={handleSubmit}
      >
        <div className="event-create-body event-inspector-fields">
          {parent && task === undefined ? (
            <p className="field-hint field-wide">
              A subtask of {parent.displayName}.
            </p>
          ) : null}
          <label className="field field-wide">
            <span>Task</span>
            <input
              ref={nameInput}
              maxLength={240}
              disabled={mutation.isPending}
              onChange={(input) =>
                draft.change({ displayName: input.target.value })
              }
              placeholder="Confirm the guest list"
              required
              value={displayName}
            />
          </label>
          <label className="field">
            <span>Due date</span>
            <input
              disabled={mutation.isPending}
              onChange={(input) =>
                draft.change({ dueDate: input.target.value })
              }
              type="date"
              value={dueDate}
            />
          </label>
          <label className="field">
            <span>Due time</span>
            <input
              disabled={mutation.isPending || dueDate === ""}
              onChange={(input) =>
                draft.change({ dueTime: input.target.value })
              }
              type="time"
              value={dueTime}
            />
          </label>
          <p className="field-hint">
            Both optional. A date without a time is due that whole day; times
            are in{" "}
            {Intl.DateTimeFormat()
              .resolvedOptions()
              .timeZone.replaceAll("_", " ")}
            .
          </p>
          {dueError && <p role="alert">{dueError}</p>}
        </div>
        <footer className="event-inspector-footer">
          <EditorControls
            disabled={!recovery.isRetained}
            draft={draft}
            mutation={mutation}
            onCancel={requestClose}
            onRefresh={task === undefined ? undefined : (onRefresh ?? refresh)}
            submitLabel={task === undefined ? "Create task" : "Save task"}
          />
          <EditorDraftStatus
            {...recovery}
            failureMessage={
              task === undefined
                ? "The last save could not be confirmed. Retry unchanged fields to reuse the same save attempt."
                : "The last save could not be confirmed. Refresh latest before trying again."
            }
          />
        </footer>
      </EditorForm>
    </dialog>
  );
}
