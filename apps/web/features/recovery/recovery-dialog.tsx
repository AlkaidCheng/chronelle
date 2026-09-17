"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useId } from "react";
import { useSessionDialog } from "../../lib/use-session-dialog";

export function RecoveryDialog({
  title,
  onClose,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const common = useTranslations("common");
  const dialog = useSessionDialog(onClose);
  const heading = useId();
  return (
    <dialog
      ref={dialog}
      className="recovery-dialog"
      aria-labelledby={heading}
      onCancel={onClose}
    >
      <header className="history-header">
        <h2 id={heading}>{title}</h2>
        <button className="button button-quiet" type="button" onClick={onClose}>
          {common("close")}
        </button>
      </header>
      {children}
    </dialog>
  );
}
