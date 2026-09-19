"use client";

import type { SectionResponse } from "@chronelle/schemas";

import { useTaskEditorQueries } from "../../lib/queries";
import type { TaskFields } from "../../lib/task-fields";
import { TaskForm } from "./task-form";
import { ObjectEditorAccess } from "./object-editor-access";

export function TaskInspector({
  eventId,
  onClose,
  sections,
  start,
  taskId,
}: {
  /** The Event the inspector was opened from, if any. */
  readonly eventId?: string | undefined;
  readonly onClose: () => void;
  /** The sections of that Event's To-dos, offered as the task's section. */
  readonly sections?: readonly SectionResponse[] | undefined;
  /** The fields the task's composer held when it handed over to the editor. */
  readonly start?: Partial<TaskFields> | undefined;
  readonly taskId: string;
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
          onCancel={onClose}
          onRefresh={refresh}
          sections={sections}
          start={start}
          task={resource}
        />
      )}
    </ObjectEditorAccess>
  );
}
