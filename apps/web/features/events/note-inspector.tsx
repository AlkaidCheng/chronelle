"use client";

import { useNoteEditorQueries } from "../../lib/queries";
import { NoteForm } from "./note-form";
import { ObjectEditorAccess } from "./object-editor-access";

export function NoteInspector({
  eventId,
  noteId,
  onClose,
}: {
  readonly eventId: string;
  readonly noteId: string;
  readonly onClose: () => void;
}) {
  const { note, access } = useNoteEditorQueries(noteId);
  return (
    <ObjectEditorAccess
      id={noteId}
      kind="note"
      resource={note}
      access={access}
      onClose={onClose}
    >
      {(resource, refresh) => (
        <NoteForm
          key={noteId}
          eventId={eventId}
          note={resource}
          onCancel={onClose}
          onRefresh={refresh}
        />
      )}
    </ObjectEditorAccess>
  );
}
