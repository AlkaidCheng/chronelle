"use client";

import { useTaskEditorQueries } from "../../lib/queries";
import { TaskForm } from "./task-form";
import { ObjectEditorAccess } from "./object-editor-access";

export function TaskInspector({
  eventId,
  taskId,
  onClose,
}: {
  /** The Event the inspector was opened from, if any. */
  readonly eventId?: string | undefined;
  readonly taskId: string;
  readonly onClose: () => void;
}) {
  const { task, access } = useTaskEditorQueries(taskId);
  return (
    <ObjectEditorAccess
      id={taskId}
      kind="task"
      resource={task}
      access={access}
      onClose={onClose}
    >
      {(resource, refresh) => (
        <TaskForm
          key={taskId}
          accessSource={access.data?.source}
          eventId={eventId}
          task={resource}
          onCancel={onClose}
          onRefresh={refresh}
        />
      )}
    </ObjectEditorAccess>
  );
}
