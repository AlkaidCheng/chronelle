"use client";

import { type ReactNode, useEffect, useState } from "react";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import { useTaskEditorQueries } from "../../lib/queries";
import { useEditorDraftStore } from "../../lib/editor-draft-context";
import { isTemporaryReadError } from "../../lib/query-errors";
import { useSessionDialog } from "../../lib/use-session-dialog";
import { TaskForm } from "./task-form";

export function TaskInspector({
  eventId,
  taskId,
  onClose,
}: {
  readonly eventId: string;
  readonly taskId: string;
  readonly onClose: () => void;
}) {
  const { task, access } = useTaskEditorQueries(taskId);
  const drafts = useEditorDraftStore();
  const [approved, setApproved] = useState(false);
  const queries = [task, access];
  const failure = queries.find((query) => query.isError);
  const denied =
    (access.data !== undefined && !access.data.actions.includes("edit")) ||
    queries.some(
      (query) => query.isError && !isTemporaryReadError(query.error),
    );
  const verified =
    !denied &&
    !failure &&
    task.isFetchedAfterMount &&
    access.isFetchedAfterMount;
  if (verified && !approved) setApproved(true);
  useEffect(() => {
    if (denied) drafts.forget(taskId);
  }, [denied, drafts, taskId]);

  async function refresh() {
    await Promise.all(
      queries.map((query) => query.refetch({ throwOnError: true })),
    );
  }

  if (!denied && (approved || verified) && task.data && access.data)
    return (
      <TaskForm
        key={taskId}
        eventId={eventId}
        task={task.data}
        onCancel={onClose}
        onRefresh={refresh}
      />
    );

  return (
    <TaskInspectorStatus onClose={onClose}>
      {denied ? (
        <p role="alert">This task is no longer available to edit.</p>
      ) : failure ? (
        <ErrorNotice
          error={failure.error}
          isRefreshing={queries.some((query) => query.isFetching)}
          onRefresh={() => {
            for (const query of queries) void query.refetch();
          }}
        />
      ) : (
        <LoadingState label="Checking task access" />
      )}
    </TaskInspectorStatus>
  );
}

function TaskInspectorStatus({
  children,
  onClose,
}: {
  readonly children: ReactNode;
  readonly onClose: () => void;
}) {
  const dialog = useSessionDialog(onClose);
  return (
    <dialog
      ref={dialog}
      className="event-create-dialog"
      aria-label="Edit task"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="event-create-header">
        <h2>Edit task</h2>
        <button
          className="dialog-close"
          type="button"
          aria-label="Close task editor"
          onClick={onClose}
        >
          &#215;
        </button>
      </header>
      <div className="event-create-body">{children}</div>
    </dialog>
  );
}
