"use client";

import type { SectionResponse } from "@livtales/schemas";
import { useTranslations } from "next-intl";
import {
  type ComponentPropsWithoutRef,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { GripIcon } from "../../components/icons";
import { RowMenu, type RowMenuEntry } from "../../components/row-menu";
import { ShareSheet } from "../events/share-sheet";

/** What the section editor saves: a name and a description, trimmed. */
export interface SectionDraft {
  readonly name: string;
  readonly description: string | null;
}

/** The longest name and description a section takes. */
export const sectionNameLimit = 120;
export const sectionDescriptionLimit = 2000;

/**
 * The in-place editor of a section: a name, a description, Save and
 * Cancel. Enter saves, Escape cancels, and an empty name cannot save. It
 * opens under an Add section line for a new section and in place of a
 * head for one being edited.
 */
export function SectionEditor({
  busy = false,
  error,
  onCancel,
  onSave,
  section,
}: {
  readonly busy?: boolean;
  readonly error?: ReactNode;
  readonly onCancel: () => void;
  readonly onSave: (draft: SectionDraft) => void;
  /** The section being edited; absent for a new one. */
  readonly section?: SectionResponse | undefined;
}) {
  const t = useTranslations("sections");
  const [name, setName] = useState(section?.name ?? "");
  const [description, setDescription] = useState(section?.description ?? "");
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameInput.current?.focus();
  }, []);
  const canSave = name.trim() !== "" && !busy;
  const save = () => {
    if (!canSave) return;
    const trimmed = description.trim();
    onSave({ name: name.trim(), description: trimmed === "" ? null : trimmed });
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      save();
    }
  };
  return (
    <form
      aria-label={section === undefined ? t("add") : t("edit")}
      className="section-editor"
      onKeyDown={onKeyDown}
      onSubmit={onSubmit}
    >
      <input
        aria-label={t("name")}
        className="section-editor-name"
        disabled={busy}
        maxLength={sectionNameLimit}
        onChange={(event) => setName(event.target.value)}
        placeholder={t("name")}
        ref={nameInput}
        type="text"
        value={name}
      />
      <textarea
        aria-label={t("description")}
        className="section-editor-description"
        disabled={busy}
        maxLength={sectionDescriptionLimit}
        onChange={(event) => setDescription(event.target.value)}
        placeholder={t("description")}
        rows={2}
        value={description}
      />
      {error === undefined ? null : (
        <p className="section-editor-error" role="alert">
          {error}
        </p>
      )}
      <div className="section-editor-foot">
        <span className="section-editor-keys">{t("keys")}</span>
        <button
          className="button button-quiet button-small"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          {t("cancel")}
        </button>
        <button
          className="button button-primary button-small"
          disabled={!canSave}
          type="submit"
        >
          {t("save")}
        </button>
      </div>
    </form>
  );
}

/**
 * The thin accent line with a pill that opens the editor for a new section
 * at this place; it shows on hover and focus.
 */
export function AddSectionLine({
  disabled = false,
  onOpen,
}: {
  readonly disabled?: boolean;
  readonly onOpen: () => void;
}) {
  const t = useTranslations("sections");
  return (
    <div className="add-section">
      <button
        className="add-section-pill"
        disabled={disabled}
        onClick={onOpen}
        type="button"
      >
        {t("add")}
      </button>
    </div>
  );
}

/**
 * The grip at the left edge of a row or a section head, in the gutter
 * beside the list. It is a button: dragging it moves the row, the arrow
 * keys move it a place, and Enter and Space lift and drop it.
 */
export function DragGrip({
  className,
  label,
  ...props
}: { readonly label: string; readonly className?: string | undefined } & Omit<
  ComponentPropsWithoutRef<"button">,
  "aria-label" | "className" | "type" | "children"
>) {
  return (
    <button
      aria-label={label}
      className={`row-grip${className === undefined ? "" : ` ${className}`}`}
      type="button"
      {...props}
    >
      <GripIcon className="row-grip-icon" />
    </button>
  );
}

/**
 * A section's head: the grip, the name in bold with the description muted
 * under it, a faint figure at the right (the open count or the total), and
 * the quiet menu with Edit section, Share section for whoever may share
 * the Event, Move up, Move down, and Delete section. Share section opens
 * the share sheet under the head, narrowed to the section.
 */
export function SectionHead({
  canEdit,
  canShare = false,
  figure,
  grip,
  isFirst,
  isLast,
  onDelete,
  onEdit,
  onMove,
  section,
}: {
  readonly canEdit: boolean;
  readonly canShare?: boolean;
  /** The open count or the section's total, faint at the right. */
  readonly figure?: ReactNode;
  readonly grip?: ReactNode;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly onDelete: () => void;
  readonly onEdit: () => void;
  readonly onMove: (direction: -1 | 1) => void;
  readonly section: SectionResponse;
}) {
  const t = useTranslations("sections");
  const share = useTranslations("share");
  const [sharing, setSharing] = useState(false);
  const entries: RowMenuEntry[] = [
    { kind: "action", label: t("edit"), onSelect: onEdit },
    ...(canShare
      ? [
          {
            kind: "action" as const,
            label: share("section"),
            onSelect: () => setSharing(true),
          },
        ]
      : []),
    {
      kind: "action",
      label: t("moveUp"),
      disabled: isFirst,
      onSelect: () => onMove(-1),
    },
    {
      kind: "action",
      label: t("moveDown"),
      disabled: isLast,
      onSelect: () => onMove(1),
    },
    { kind: "rule" },
    {
      kind: "action",
      label: t("delete"),
      danger: true,
      onSelect: onDelete,
    },
  ];
  return (
    <div className="section-head">
      {grip}
      <SectionTitle section={section} />
      {figure === undefined || figure === null ? null : (
        <span className="section-figure">{figure}</span>
      )}
      {canEdit ? (
        <RowMenu
          className="section-head-menu"
          entries={entries}
          label={t("actionsFor", { name: section.name })}
        />
      ) : null}
      {sharing ? (
        <ShareSheet
          eventId={section.eventId}
          hint={share("sectionHint")}
          name={section.name}
          onClose={() => setSharing(false)}
          scope={{ view: section.view, sectionId: section.id }}
        />
      ) : null}
    </div>
  );
}

/** The name in bold with the description muted under it. */
export function SectionTitle({
  section,
}: {
  readonly section: Pick<SectionResponse, "name" | "description">;
}) {
  return (
    <div className="section-title">
      <strong className="section-name">{section.name}</strong>
      {section.description === null ? null : (
        <small className="section-description">{section.description}</small>
      )}
    </div>
  );
}
