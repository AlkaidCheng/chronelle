"use client";

import { useTranslations } from "next-intl";
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

/** The labels as a checklist with a field to add one: the picker's body and the chip's control. */
export function LabelChoices({
  disabled,
  onChange,
  value,
}: {
  readonly disabled: boolean;
  readonly onChange: (labels: string) => void;
  readonly value: string;
}) {
  const t = useTranslations("labels");
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
      <legend className="visually-hidden">{t("choose")}</legend>
      {labels.isError ? (
        <p role="alert">{t("loadFailed")}</p>
      ) : labels.data === undefined ? (
        <p className="field-hint">{t("loading")}</p>
      ) : labels.data.items.length === 0 ? (
        <p className="field-hint">{t("noneYet")}</p>
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
          label={t("newLabel")}
          limit={40}
          onChange={setDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder={t("newLabel")}
          value={draft}
        />
        <button
          className="button button-secondary button-small"
          disabled={draft.trim() === "" || create.isPending}
          onClick={add}
          type="button"
        >
          {create.isPending ? t("adding") : t("add")}
        </button>
      </div>
      {create.isError ? (
        <p role="alert">
          {create.error instanceof Error
            ? create.error.message
            : t("addFailed")}
        </p>
      ) : null}
    </fieldset>
  );
}
