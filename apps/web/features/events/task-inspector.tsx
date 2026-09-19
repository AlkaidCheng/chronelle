"use client";

import type { SectionResponse } from "@chronelle/schemas";

import { useTaskEditorQueries } from "../../lib/queries";
import { TaskForm } from "./task-form";
import { ObjectEditorAccess } from "./object-editor-access";

export function TaskInspector({
  eventId,
  sections,
  taskId,
  onClose,
}: {
  /** The Event the inspector was opened from, if any. */
  readonly eventId?: string | undefined;
  /** The sections of that Event's To-dos, offered as the task's section. */
  readonly sections?: readonly SectionResponse[] | undefined;
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
          sections={sections}
          task={resource}
          onCancel={onClose}
          onRefresh={refresh}
        />
      )}
    </ObjectEditorAccess>
  );
}
