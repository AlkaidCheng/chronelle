"use client";

import { ObjectEditorAccess } from "../events/object-editor-access";
import { usePersonEditorQueries } from "../../lib/queries";
import { PersonForm } from "./person-form";

export function PersonInspector({
  personId,
  onClose,
}: {
  readonly personId: string;
  readonly onClose: () => void;
}) {
  const { person, access } = usePersonEditorQueries(personId);
  return (
    <ObjectEditorAccess
      id={personId}
      kind="person"
      resource={person}
      access={access}
      onClose={onClose}
    >
      {(resource, refresh) => (
        <PersonForm
          key={personId}
          person={resource}
          onCancel={onClose}
          onRefresh={refresh}
        />
      )}
    </ObjectEditorAccess>
  );
}
