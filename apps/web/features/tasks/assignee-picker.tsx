"use client";

import { useState } from "react";

import { CountedField } from "../../components/counted-field";
import { personDisplayName } from "../../lib/person-fields";
import {
  useCreatePerson,
  usePersonsQuery,
  useSessionQuery,
} from "../../lib/queries";

/**
 * The task's assignee behind a disclosure: closed, it names the assignee
 * and reads the people only when one is set; open, it lists the workspace's
 * people as a choice with Unassigned, adds a person who does not exist yet,
 * and assigns to the signed-in user, creating their person on first use.
 */
export function AssigneePicker({
  disabled = false,
  onChange,
  value,
}: {
  readonly disabled?: boolean;
  /** The assignee's person id, or the empty string for none. */
  readonly onChange: (assignee: string) => void;
  readonly value: string;
}) {
  const [open, setOpen] = useState(false);
  const persons = usePersonsQuery(open || value !== "");
  const name =
    value === ""
      ? "Unassigned"
      : (persons.data?.names.get(value) ?? "Assigned");
  return (
    <details
      className="assignee-picker field-wide"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Assignee: {name}</summary>
      {open ? (
        <AssigneeChoices
          disabled={disabled}
          onChange={onChange}
          persons={persons}
          value={value}
        />
      ) : null}
    </details>
  );
}

function AssigneeChoices({
  disabled,
  onChange,
  persons,
  value,
}: {
  readonly disabled: boolean;
  readonly onChange: (assignee: string) => void;
  readonly persons: ReturnType<typeof usePersonsQuery>;
  readonly value: string;
}) {
  const session = useSessionQuery();
  const create = useCreatePerson();
  const [draft, setDraft] = useState("");
  const me = session.data?.user;
  const myPerson = persons.data?.items.find(
    (person) => me !== undefined && person.userId === me.id,
  );

  // The picker sits inside the task editor's form, so adding a person is a
  // button and an Enter key, never a form of its own.
  function add() {
    const displayName = draft.trim();
    if (displayName === "" || create.isPending) return;
    create.mutate(
      { displayName },
      {
        onSuccess: (person) => {
          setDraft("");
          onChange(person.id);
        },
      },
    );
  }

  function assignToMe() {
    if (myPerson !== undefined) {
      onChange(myPerson.id);
      return;
    }
    if (me === undefined || create.isPending) return;
    create.mutate(
      { displayName: me.displayName, userId: me.id },
      { onSuccess: (person) => onChange(person.id) },
    );
  }

  return (
    <fieldset className="assignee-choices" disabled={disabled}>
      <legend className="visually-hidden">Assign to</legend>
      {persons.isError ? (
        <p role="alert">People could not be loaded.</p>
      ) : persons.data === undefined ? (
        <p className="field-hint">Loading people...</p>
      ) : (
        <ul className="label-options">
          <li>
            <label className="check-field">
              <input
                checked={value === ""}
                name="assignee"
                onChange={() => onChange("")}
                type="radio"
              />
              <span>Unassigned</span>
            </label>
          </li>
          {persons.data.items.map((person) => (
            <li key={person.id}>
              <label className="check-field">
                <input
                  checked={value === person.id}
                  name="assignee"
                  onChange={() => onChange(person.id)}
                  type="radio"
                />
                <span>
                  {personDisplayName(person)}
                  {person.id === myPerson?.id ? " (me)" : ""}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="label-add">
        <CountedField
          hideLabel
          label="New person"
          limit={240}
          onChange={setDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder="New person"
          value={draft}
        />
        <button
          className="button button-secondary button-small"
          disabled={draft.trim() === "" || create.isPending}
          onClick={add}
          type="button"
        >
          {create.isPending ? "Adding..." : "Add person"}
        </button>
        <button
          className="button button-quiet button-small"
          disabled={
            me === undefined ||
            create.isPending ||
            (myPerson !== undefined && value === myPerson.id)
          }
          onClick={assignToMe}
          type="button"
        >
          Assign to me
        </button>
      </div>
      {create.isError ? (
        <p role="alert">
          {create.error instanceof Error
            ? create.error.message
            : "The person could not be added."}
        </p>
      ) : null}
    </fieldset>
  );
}
