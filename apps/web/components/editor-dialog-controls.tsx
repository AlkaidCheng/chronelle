"use client";

import { useTranslations } from "next-intl";
import type { ReactNode, Ref } from "react";

export function EditorDialogHeader({
  headingId,
  title,
  closeLabel,
  isConfirming,
  isPending,
  onClose,
  children,
}: {
  readonly headingId: string;
  readonly title: string;
  readonly closeLabel: string;
  readonly isConfirming: boolean;
  readonly isPending: boolean;
  readonly onClose: () => void;
  readonly children?: ReactNode;
}) {
  return (
    <header className="event-create-header">
      <h2 id={headingId}>{title}</h2>
      {children}
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
