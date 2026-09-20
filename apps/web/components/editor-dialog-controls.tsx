"use client";

import { useTranslations } from "next-intl";
import type { ReactNode, Ref } from "react";
import { type HelpEntry, HelpToggle } from "./help-toggle";

/** What a dialog's help control shows: the dialog's kind and its entries. */
export interface DialogHelp {
  readonly surface: string;
  readonly entries: readonly HelpEntry[];
}

/**
 * A dialog's header: the title, then its controls at the right edge (any
 * the dialog adds, the help control when it has exposition, the close).
 * While the dialog asks to confirm a discard, the controls hide.
 */
export function EditorDialogHeader({
  headingId,
  title,
  closeLabel,
  isConfirming = false,
  isPending = false,
  onClose,
  help,
  children,
}: {
  readonly headingId: string;
  readonly title: string;
  readonly closeLabel: string;
  readonly isConfirming?: boolean;
  readonly isPending?: boolean;
  readonly onClose: () => void;
  readonly help?: DialogHelp | undefined;
  readonly children?: ReactNode;
}) {
  return (
    <header className="event-create-header">
      <h2 id={headingId}>{title}</h2>
      <span className="dialog-head-actions">
        {children}
        {help === undefined ? null : (
          <HelpToggle
            surface={help.surface}
            entries={help.entries}
            hidden={isConfirming}
            disabled={isPending}
          />
        )}
        <button
          hidden={isConfirming}
          className="dialog-close"
          type="button"
          aria-label={closeLabel}
          disabled={isPending}
          onClick={onClose}
        >
          &#215;
        </button>
      </span>
    </header>
  );
}

export function DiscardActions({
  keepEditingButton,
  onKeepEditing,
  onDiscard,
}: {
  readonly keepEditingButton: Ref<HTMLButtonElement>;
  readonly onKeepEditing: () => void;
  readonly onDiscard: () => void;
}) {
  const t = useTranslations("editor");
  return (
    <>
      <button className="button button-quiet" type="button" onClick={onDiscard}>
        {t("discard")}
      </button>
      <button
        ref={keepEditingButton}
        className="button button-primary"
        type="button"
        onClick={onKeepEditing}
      >
        {t("keepEditing")}
      </button>
    </>
  );
}
