"use client";

import { useReminderEditorQueries } from "../../lib/queries";
import type { ReminderFields } from "../../lib/reminder-fields";
import { ReminderForm } from "./reminder-form";
import { ObjectEditorAccess } from "./object-editor-access";

export function ReminderInspector({
  eventId,
  onClose,
  reminderId,
  start,
}: {
  readonly eventId: string;
  readonly onClose: () => void;
  readonly reminderId: string;
  /** The fields the reminder's composer held when it handed over to the editor. */
  readonly start?: Partial<ReminderFields> | undefined;
}) {
  const { reminder, access } = useReminderEditorQueries(reminderId);
  return (
    <ObjectEditorAccess
      id={reminderId}
      kind="reminder"
      resource={reminder}
      access={access}
      onClose={onClose}
    >
      {(resource, refresh) => (
        <ReminderForm
          key={reminderId}
          eventId={eventId}
          reminder={resource}
          onCancel={onClose}
          onRefresh={refresh}
          start={start}
        />
      )}
    </ObjectEditorAccess>
  );
}
