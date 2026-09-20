"use client";

import type { PersonContactKind } from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import {
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { ChipPanel } from "../../components/chip";
import { FieldRow } from "../../components/field-row";
import {
  AddIcon,
  FieldIcon,
  GlobeIcon,
  LinesIcon,
  MailIcon,
  PhoneIcon,
  TagIcon,
} from "../../components/icons";
import type { PersonContactField, PersonField } from "../../lib/person-fields";
import { useLabelsQuery } from "../../lib/queries";
import { splitLabelIds } from "../../lib/task-fields";
import { LabelChoices } from "../tasks/label-picker";

const contactKinds: readonly PersonContactKind[] = ["email", "phone", "other"];
const contactInputTypes: Record<PersonContactKind, string> = {
  email: "email",
  phone: "tel",
  other: "text",
};
const contactLimit = 254;
const fieldNameLimit = 60;
const fieldValueLimit = 500;
const descriptionLimit = 2000;

function contactIcon(kind: PersonContactKind) {
  const Icon =
    kind === "email" ? MailIcon : kind === "phone" ? PhoneIcon : GlobeIcon;
  return <Icon className="field-row-icon" />;
}

/** A row whose only job is to add one more of something: a plus and the verb. */
function AddRow({
  disabled,
  label,
  onPress,
}: {
  readonly disabled: boolean;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <FieldRow
      disabled={disabled}
      icon={<AddIcon className="field-row-icon" />}
      label={label}
      onPress={onPress}
      value=""
    />
  );
}

/**
 * The contacts as rows, each with its kind's symbol: a row reads its
 * value with a clear that removes it, and opens in place as kind + value
 * when pressed. Add contact appends a row already open; a row left empty
 * when editing ends is dropped.
 */
export function ContactRows({
  contacts,
  disabled,
  onChange,
}: {
  readonly contacts: readonly PersonContactField[];
  readonly disabled: boolean;
  readonly onChange: (contacts: readonly PersonContactField[]) => void;
}) {
  const t = useTranslations("person");
  const [editing, setEditing] = useState<number | null>(null);
  const valueInput = useRef<HTMLInputElement>(null);
  const rowButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const [focus, setFocus] = useState<
    { readonly kind: "input" } | { readonly kind: "row"; index: number } | null
  >(null);
  useEffect(() => {
    if (focus?.kind === "input") valueInput.current?.focus();
    else if (focus?.kind === "row") rowButtons.current[focus.index]?.focus();
    setFocus(null);
  }, [focus]);
  const kindLabels: Record<PersonContactKind, string> = {
    email: t("contactKinds.email"),
    phone: t("contactKinds.phone"),
    other: t("contactKinds.other"),
  };
  const change = (index: number, patch: Partial<PersonContactField>) =>
    onChange(
      contacts.map((row, at) => (at === index ? { ...row, ...patch } : row)),
    );
  const remove = (index: number) =>
    onChange(contacts.filter((_, at) => at !== index));
  // Editing ends by Enter, Escape, or focus leaving the row; an empty row goes.
  const stopEditing = (index: number, focusRow: boolean) => {
    setEditing(null);
    if (contacts[index]?.value.trim() === "") {
      remove(index);
      return;
    }
    if (focusRow) setFocus({ kind: "row", index });
  };
  const editingRow = useRef<HTMLDivElement>(null);
  // Both controls of the open row end the editing the same way.
  const editingHandlers = (index: number) => ({
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!editingRow.current?.contains(event.relatedTarget))
        stopEditing(index, false);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        stopEditing(index, true);
      }
    },
  });
  return (
    <>
      {contacts.map((contact, index) =>
        editing === index ? (
          <div
            className="field-row is-editing person-contact-editing"
            // Rows have no identity of their own; their position is it.
            // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
            key={index}
            ref={editingRow}
          >
            {contactIcon(contact.kind)}
            <select
              {...editingHandlers(index)}
              aria-label={t("contactKind", { n: index + 1 })}
              className="field-row-input person-contact-kind"
              disabled={disabled}
              onChange={(event) =>
                change(index, {
                  kind: event.target.value as PersonContactKind,
                })
              }
              value={contact.kind}
            >
              {contactKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kindLabels[kind]}
                </option>
              ))}
            </select>
            <input
              {...editingHandlers(index)}
              aria-label={t("contactValue", { n: index + 1 })}
              className="field-row-input"
              disabled={disabled}
              maxLength={contactLimit}
              onChange={(event) => change(index, { value: event.target.value })}
              placeholder={kindLabels[contact.kind]}
              ref={valueInput}
              type={contactInputTypes[contact.kind]}
              value={contact.value}
            />
          </div>
        ) : (
          <FieldRow
            buttonRef={(button) => {
              rowButtons.current[index] = button;
            }}
            clearLabel={t("removeContact", { n: index + 1 })}
            disabled={disabled}
            icon={contactIcon(contact.kind)}
            // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
            key={index}
            label={kindLabels[contact.kind]}
            onClear={() => remove(index)}
            onPress={() => {
              setEditing(index);
              setFocus({ kind: "input" });
            }}
            value={contact.value}
          />
        ),
      )}
      <AddRow
        disabled={disabled || contacts.length >= 20}
        label={t("addContact")}
        onPress={() => {
          onChange([...contacts, { kind: "email", value: "" }]);
          setEditing(contacts.length);
          setFocus({ kind: "input" });
        }}
      />
    </>
  );
}

/**
 * The labels as one row: it reads the chosen labels' names, or "Labels"
 * while none are chosen, and opens the checklist under it; its clear
 * drops them all.
 */
export function LabelsRow({
  disabled,
  onChange,
  value,
}: {
  readonly disabled: boolean;
  readonly onChange: (labels: string) => void;
  readonly value: string;
}) {
  const t = useTranslations("person");
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const chosen = splitLabelIds(value);
  const names = useLabelsQuery(open || chosen.length > 0).data?.names;
  const reads = chosen.map((id) => names?.get(id) ?? "").join(", ");
  return (
    <FieldRow
      buttonRef={button}
      clearLabel={t("clearLabels")}
      disabled={disabled}
      expanded={open}
      icon={<TagIcon className="field-row-icon" />}
      label={t("labels")}
      onClear={() => onChange("")}
      onPress={() => setOpen(!open)}
      value={reads}
    >
      {open ? (
        <ChipPanel
          label={t("labels")}
          onClose={(byKeyboard) => {
            setOpen(false);
            if (byKeyboard) button.current?.focus();
          }}
        >
          <LabelChoices disabled={disabled} onChange={onChange} value={value} />
        </ChipPanel>
      ) : null}
    </FieldRow>
  );
}

/** The description as a row: the lines symbol and a field that grows with its text. */
export function DescriptionRow({
  disabled,
  onChange,
  value,
}: {
  readonly disabled: boolean;
  readonly onChange: (description: string) => void;
  readonly value: string;
}) {
  const t = useTranslations("person");
  const rows = Math.min(8, Math.max(1, value.split("\n").length));
  return (
    <div className="field-row is-editing person-description-row">
      <LinesIcon className="field-row-icon" />
      <textarea
        aria-label={t("description")}
        className="field-row-input person-description-field"
        disabled={disabled}
        maxLength={descriptionLimit}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("addDescription")}
        rows={rows}
        value={value}
      />
    </div>
  );
}

/**
 * The custom fields, each a row of name + value with a remove at the end,
 * and Add field after them appending an empty row with its name focused.
 */
export function CustomFieldRows({
  disabled,
  fields,
  onChange,
}: {
  readonly disabled: boolean;
  readonly fields: readonly PersonField[];
  readonly onChange: (fields: readonly PersonField[]) => void;
}) {
  const te = useTranslations("personEditor");
  const nameInputs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  useEffect(() => {
    if (focusIndex !== null) nameInputs.current[focusIndex]?.focus();
    setFocusIndex(null);
  }, [focusIndex]);
  const change = (index: number, patch: Partial<PersonField>) =>
    onChange(
      fields.map((row, at) => (at === index ? { ...row, ...patch } : row)),
    );
  return (
    <>
      {fields.map((field, index) => (
        <div
          className="field-row is-editing person-field-editing"
          // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
          key={index}
        >
          <FieldIcon className="field-row-icon" />
          <input
            aria-label={te("fieldName", { n: index + 1 })}
            className="field-row-input person-field-name"
            disabled={disabled}
            maxLength={fieldNameLimit}
            onChange={(event) => change(index, { key: event.target.value })}
            placeholder={te("fieldPlaceholder")}
            ref={(input) => {
              nameInputs.current[index] = input;
            }}
            value={field.key}
          />
          <input
            aria-label={te("fieldValue", { n: index + 1 })}
            className="field-row-input"
            disabled={disabled}
            maxLength={fieldValueLimit}
            onChange={(event) => change(index, { value: event.target.value })}
            placeholder={te("valuePlaceholder")}
            value={field.value}
          />
          <button
            aria-label={te("removeField", {
              name: field.key || String(index + 1),
            })}
            className="field-row-clear"
            disabled={disabled}
            onClick={() => onChange(fields.filter((_, at) => at !== index))}
            type="button"
          >
            &#215;
          </button>
        </div>
      ))}
      <AddRow
        disabled={disabled}
        label={te("addField")}
        onPress={() => {
          onChange([...fields, { key: "", value: "" }]);
          setFocusIndex(fields.length);
        }}
      />
    </>
  );
}

/** The editors' rows of the person dialog under the name, ruled like the schedule rows. */
export function PersonRows({ children }: { readonly children: ReactNode }) {
  return <div className="person-rows">{children}</div>;
}
