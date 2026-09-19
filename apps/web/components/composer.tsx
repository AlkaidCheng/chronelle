"use client";

import { useTranslations } from "next-intl";
import {
  type FormEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useRef,
} from "react";

import { descriptionLimit } from "../lib/description-field";
import { EditorForm } from "./editor-form";
import { LinesIcon, MoreIcon } from "./icons";

/** The name field of the composer: what the record is called. */
export interface ComposerName {
  readonly label: string;
  readonly limit: number;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly value: string;
}

/** The description under the name, for the kinds that carry one. */
export interface ComposerDescription {
  readonly onChange: (value: string) => void;
  readonly value: string;
}

/** The way to the full editor from the composer's foot. */
export interface ComposerMore {
  /** The button's accessible name, starting with its word. */
  readonly label: string;
  readonly onOpen: () => void;
}

/** The question a composer asks before another opens over its unsaved changes. */
export interface ComposerQuestion {
  readonly text: string;
  readonly onDiscard: () => void;
  readonly onKeep: () => void;
}

/**
 * The card a row becomes when pressed, and the add row opens as: the name
 * (bold, one line), the description (a growing field), then one chip per
 * field of the kind, and a foot with More, the keys hint, Cancel, and Save
 * (or Add). Enter in the name saves; Escape closes the composer, or the
 * chip's control open under it. The composer is one form named for what
 * it edits, so a list's rows stay one landmark each.
 */
export function Composer({
  busy = false,
  chips,
  description,
  error,
  label,
  more,
  name,
  nameRef,
  notice,
  onCancel,
  onEscape,
  onSubmit,
  question,
  status,
  submitDisabled = false,
  submitLabel,
}: {
  /** A save in flight: the fields stay, the actions wait. */
  readonly busy?: boolean;
  readonly chips: ReactNode;
  readonly description?: ComposerDescription | undefined;
  /** A refused field, read under the chips. */
  readonly error?: string | undefined;
  /** The form's accessible name: "Edit <name>" or the new record. */
  readonly label: string;
  readonly more?: ComposerMore | undefined;
  readonly name: ComposerName;
  readonly nameRef?: Ref<HTMLInputElement> | undefined;
  /** A notice above the chips: a refused save, a comparison. */
  readonly notice?: ReactNode;
  readonly onCancel: () => void;
  /** Escape with no chip open; the composer decides what it closes. */
  readonly onEscape: () => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly question?: ComposerQuestion | undefined;
  /** What the composer just did, for the live region: "Added.". */
  readonly status?: string | undefined;
  readonly submitDisabled?: boolean;
  readonly submitLabel: string;
}) {
  const t = useTranslations("composer");
  const common = useTranslations("common");
  const editor = useTranslations("editor");
  const keepButton = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const asked = question !== undefined;
  useEffect(() => {
    if (asked) keepButton.current?.focus();
  }, [asked]);
  // Escape anywhere in the composer closes it, unless a chip's control is
  // open under it, which takes the key itself.
  const closeOnEscape = useRef(onEscape);
  closeOnEscape.current = onEscape;
  useEffect(() => {
    const form = body.current?.closest("form");
    if (!form) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (
        form.querySelector('.chip-main[aria-expanded="true"]') !== null ||
        form.querySelector(".composer-question") !== null
      )
        return;
      event.preventDefault();
      closeOnEscape.current();
    };
    form.addEventListener("keydown", onKeyDown);
    return () => form.removeEventListener("keydown", onKeyDown);
  }, []);
  const rows =
    description === undefined
      ? 1
      : Math.min(8, Math.max(1, description.value.split("\n").length));
  return (
    <EditorForm
      aria-busy={busy}
      aria-label={label}
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!asked) onSubmit(event);
      }}
    >
      {question !== undefined ? (
        <div className="composer-question">
          <p>{question.text}</p>
          <div className="composer-foot">
            <span className="composer-spacer" />
            <button
              className="button button-quiet button-small"
              onClick={question.onDiscard}
              type="button"
            >
              {editor("discard")}
            </button>
            <button
              className="button button-primary button-small"
              onClick={question.onKeep}
              ref={keepButton}
              type="button"
            >
              {editor("keepEditing")}
            </button>
          </div>
        </div>
      ) : (
        <div className="composer-body" ref={body}>
          <input
            aria-label={name.label}
            className="composer-name"
            disabled={busy}
            maxLength={name.limit}
            onChange={(event) => name.onChange(event.target.value)}
            placeholder={name.placeholder}
            ref={nameRef}
            required
            type="text"
            value={name.value}
          />
          {description === undefined ? null : (
            <div className="composer-description">
              <LinesIcon className="composer-description-icon" />
              <textarea
                aria-label={editor("description")}
                disabled={busy}
                maxLength={descriptionLimit}
                onChange={(event) => description.onChange(event.target.value)}
                placeholder={editor("descriptionPlaceholder")}
                rows={rows}
                value={description.value}
              />
            </div>
          )}
          {notice}
          <div className="composer-chips">{chips}</div>
          {error === undefined || error === "" ? null : (
            <p className="composer-error" role="alert">
              {error}
            </p>
          )}
          <footer className="composer-foot">
            {more === undefined ? null : (
              <button
                aria-label={more.label}
                className="composer-more"
                disabled={busy}
                onClick={more.onOpen}
                type="button"
              >
                <MoreIcon />
                <span>{t("more")}</span>
              </button>
            )}
            <span aria-hidden="true" className="composer-keys">
              {t("keys")}
            </span>
            <span className="composer-spacer" />
            <button
              className="button button-quiet button-small"
              disabled={busy}
              onClick={onCancel}
              type="button"
            >
              {common("cancel")}
            </button>
            <button
              className="button button-primary button-small"
              data-editor-submit=""
              disabled={busy || submitDisabled}
              type="submit"
            >
              {busy ? editor("saving") : submitLabel}
            </button>
          </footer>
          <p aria-live="polite" className="visually-hidden" role="status">
            {status ?? ""}
          </p>
        </div>
      )}
    </EditorForm>
  );
}
