"use client";

import { useReminderEditorQueries } from "../../lib/queries";
import { ReminderForm } from "./reminder-form";
import { ObjectEditorAccess } from "./object-editor-access";

export function ReminderInspector({
  eventId,
  reminderId,
  onClose,
}: {
  readonly eventId: string;
  readonly reminderId: string;
  readonly onClose: () => void;
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
        />
      )}
    </ObjectEditorAccess>
  );
}
