"use client";

import { useState } from "react";

import { CountedField } from "../../components/counted-field";
import { joinLabelIds, splitLabelIds } from "../../lib/task-fields";
import { useCreateLabel, useLabelsQuery } from "../../lib/queries";

/**
 * The task's labels behind a disclosure: closed, it counts the selection and
 * reads nothing; open, it lists the workspace's labels as checkboxes with a
 * field to add one that does not exist yet, selected as soon as it exists.
 */
export function LabelPicker({
  disabled = false,
  onChange,
  value,
}: {
  readonly disabled?: boolean;
  /** The selected label ids as the task fields hold them. */
  readonly onChange: (labels: string) => void;
  readonly value: string;
}) {
  const [open, setOpen] = useState(false);
  const count = splitLabelIds(value).length;
  return (
    <details
      className="label-picker field-wide"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Labels{count > 0 ? ` (${count})` : ""}</summary>
      {open ? (
        <LabelChoices disabled={disabled} onChange={onChange} value={value} />
      ) : null}
    </details>
  );
}

function LabelChoices({
  disabled,
  onChange,
  value,
}: {
  readonly disabled: boolean;
  readonly onChange: (labels: string) => void;
  readonly value: string;
}) {
  const labels = useLabelsQuery();
  const create = useCreateLabel();
  const [draft, setDraft] = useState("");
  const selected = new Set(splitLabelIds(value));

  function toggle(id: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onChange(joinLabelIds([...next]));
  }

  // The picker sits inside the task editor's form, so adding a label is a
  // button and an Enter key, never a form of its own.
  function add() {
    const name = draft.trim();
    if (name === "" || create.isPending) return;
    create.mutate(
      { name },
      {
        onSuccess: (label) => {
          setDraft("");
          onChange(joinLabelIds([...selected, label.id]));
        },
      },
    );
  }

  return (
    <fieldset className="label-choices" disabled={disabled}>
      <legend className="visually-hidden">Choose labels</legend>
      {labels.isError ? (
        <p role="alert">Labels could not be loaded.</p>
      ) : labels.data === undefined ? (
        <p className="field-hint">Loading labels...</p>
      ) : labels.data.items.length === 0 ? (
        <p className="field-hint">No labels yet. Add one below.</p>
      ) : (
        <ul className="label-options">
          {labels.data.items.map((label) => (
            <li key={label.id}>
              <label className="check-field">
                <input
                  checked={selected.has(label.id)}
                  onChange={(input) => toggle(label.id, input.target.checked)}
                  type="checkbox"
                />
                <span>{label.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="label-add">
        <CountedField
          hideLabel
          label="New label"
          limit={40}
          onChange={setDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder="New label"
          value={draft}
        />
        <button
          className="button button-secondary button-small"
          disabled={draft.trim() === "" || create.isPending}
          onClick={add}
          type="button"
        >
          {create.isPending ? "Adding..." : "Add label"}
        </button>
      </div>
      {create.isError ? (
        <p role="alert">
          {create.error instanceof Error
            ? create.error.message
            : "The label could not be added."}
        </p>
      ) : null}
    </fieldset>
  );
}
