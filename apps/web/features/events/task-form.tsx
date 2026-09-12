"use client";

import type { TaskResponse } from "@chronelle/schemas";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { EditorForm } from "../../components/editor-form";
import { EditorControls } from "./editor-controls";
import { readTaskFields, taskFieldsPayload } from "../../lib/task-fields";
import { isDraftAccessError } from "../../lib/event-draft-store";
import { useDiscardConfirmation } from "../../lib/use-discard-confirmation";
import { useSessionDialog } from "../../lib/use-session-dialog";
import { useOpenHistory } from "../history/history-provider";
import { useEditorDraft } from "../../lib/use-editor-draft";
import {
  useCreateTask,
  useRefreshEvent,
  useUpdateTask,
} from "../../lib/queries";

export function TaskForm({
  eventId,
  onCancel,
  onRefresh,
  task: latestTask,
}: {
  readonly eventId: string;
  readonly onCancel?: (() => void) | undefined;
  readonly onRefresh?: (() => Promise<void>) | undefined;
  readonly task?: TaskResponse | undefined;
}) {
  const draft = useEditorDraft(latestTask, readTaskFields);
  const task = draft.source;
  const create = useCreateTask(eventId);
  const update = useUpdateTask();
  const refresh = useRefreshEvent(eventId, { throwOnError: true });
  const { displayName, dueAt } = draft.fields;
  const mutation = task === undefined ? create : update;
  const [dueError, setDueError] = useState("");
  const headingId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const openHistory = useOpenHistory();
  const close = () => onCancel?.();
  const dialog = useSessionDialog(close);
  const { isConfirming, keepEditingButton, keepEditing, requestClose } =
    useDiscardConfirmation({
      isDirty: draft.isDirty,
      isPending: mutation.isPending,
      onClose: close,
    });
  useEffect(() => {
    nameInput.current?.focus();
  }, []);
  useEffect(() => {
    if (isDraftAccessError(mutation.error)) onCancel?.();
  }, [mutation.error, onCancel]);
  useEffect(() => {
    if (!draft.isDirty && !mutation.isPending) return;
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [draft.isDirty, mutation.isPending]);

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (isConfirming || draft.hasNewerVersion || mutation.isPending) return;
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
    if (task === undefined) {
      create.mutate(input, {
        onSuccess: () => {
          draft.change({ displayName: "", dueAt: "" });
          onCancel?.();
        },
      });
      return;
    }
    update.mutate(
      {
        id: task.id,
        input: { ...input, expectedVersion: task.version },
      },
      {
        onSuccess: (saved) => {
          draft.accept(saved);
          onCancel?.();
        },
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
      <header className="event-create-header">
        <h2 id={headingId}>
          {isConfirming
            ? "Discard task changes?"
            : task
              ? "Edit task"
              : "Add task"}
        </h2>
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
        <button
          hidden={isConfirming}
          className="dialog-close"
          type="button"
          aria-label="Close task editor"
          disabled={mutation.isPending}
          onClick={requestClose}
        >
          &#215;
        </button>
      </header>
      {isConfirming && (
        <div className="event-create-body">
          <p>Your task changes have not been saved.</p>
          <div className="form-actions">
            <button
              className="button button-quiet"
              type="button"
              onClick={close}
            >
              Discard
            </button>
            <button
              ref={keepEditingButton}
              className="button button-primary"
              type="button"
              onClick={keepEditing}
            >
              Keep editing
            </button>
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
            <span>Due</span>
            <input
              disabled={mutation.isPending}
              onChange={(input) => draft.change({ dueAt: input.target.value })}
              type="datetime-local"
              value={dueAt}
            />
          </label>
          <p className="field-hint">
            Optional. Times in{" "}
            {Intl.DateTimeFormat()
              .resolvedOptions()
              .timeZone.replaceAll("_", " ")}
            .
          </p>
          {dueError && <p role="alert">{dueError}</p>}
        </div>
        <footer className="event-inspector-footer">
          <EditorControls
            draft={draft}
            mutation={mutation}
            onCancel={requestClose}
            onRefresh={task === undefined ? undefined : (onRefresh ?? refresh)}
            submitLabel={task === undefined ? "Create task" : "Save task"}
          />
        </footer>
      </EditorForm>
    </dialog>
  );
}
