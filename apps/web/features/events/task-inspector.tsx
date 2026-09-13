"use client";

import { useTaskEditorQueries } from "../../lib/queries";
import { TaskForm } from "./task-form";
import { ObjectEditorAccess } from "./object-editor-access";

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
          eventId={eventId}
          task={resource}
          onCancel={onClose}
          onRefresh={refresh}
        />
      )}
    </ObjectEditorAccess>
  );
}
