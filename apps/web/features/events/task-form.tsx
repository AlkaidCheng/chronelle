"use client";

import type { TaskResponse } from "@chronelle/schemas";
import type { FormEvent } from "react";
import { EditorForm } from "../../components/editor-form";
import { EditorControls } from "./editor-controls";
import { fromDateTimeInput, toDateTimeInput } from "../../lib/format";
import { useEditorDraft } from "../../lib/use-editor-draft";
import {
  useCreateTask,
  useRefreshEvent,
  useUpdateTask,
} from "../../lib/queries";

export function TaskForm({
  eventId,
  onCancel,
  task: latestTask,
}: {
  readonly eventId: string;
  readonly onCancel?: (() => void) | undefined;
  readonly task?: TaskResponse | undefined;
}) {
  const draft = useEditorDraft(latestTask, (task) => ({
    displayName: task?.displayName ?? "",
    dueAt: toDateTimeInput(task?.dueAt ?? null),
  }));
  const task = draft.source;
  const create = useCreateTask(eventId);
  const update = useUpdateTask();
  const refresh = useRefreshEvent(eventId, { throwOnError: true });
  const { displayName, dueAt } = draft.fields;

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (draft.hasNewerVersion || mutation.isPending) return;
    const input = { displayName, dueAt: fromDateTimeInput(dueAt) };
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

  const mutation = task === undefined ? create : update;
  return (
    <EditorForm
      aria-busy={mutation.isPending}
      className="editor-form inline-editor"
      onChangeCapture={() => {
        if (mutation.isSuccess) mutation.reset();
      }}
      onSubmit={handleSubmit}
    >
      <label className="field field-wide">
        <span>Task</span>
        <input
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
      <EditorControls
        draft={draft}
        mutation={mutation}
        onCancel={onCancel}
        onRefresh={task === undefined ? undefined : refresh}
        submitLabel={task === undefined ? "Add task" : "Save task"}
      />
    </EditorForm>
  );
}
