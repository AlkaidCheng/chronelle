"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

/**
 * A button that asks one line before it acts, in place: the question, the
 * verb again to confirm, and Cancel. For actions that take access from
 * other people or move a record to Trash.
 */
export function ConfirmAction({
  className = "button button-quiet button-small",
  disabled = false,
  label,
  onConfirm,
  pending = false,
  pendingLabel,
  question,
  trigger,
}: {
  readonly className?: string;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onConfirm: () => void;
  readonly pending?: boolean;
  readonly pendingLabel?: string;
  readonly question: string;
  /** What the first button shows in place of the label, which then names it. */
  readonly trigger?: ReactNode;
}) {
  const common = useTranslations("common");
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button
        aria-label={trigger === undefined ? undefined : label}
        className={className}
        disabled={disabled}
        onClick={() => setAsking(true)}
        type="button"
      >
        {trigger ?? label}
      </button>
    );
  return (
    <span className="confirm-line">
      <span>{question}</span>
      <button
        className="button button-primary button-small"
        disabled={disabled || pending}
        onClick={() => {
          onConfirm();
          setAsking(false);
        }}
        type="button"
      >
        {pending ? (pendingLabel ?? label) : label}
      </button>
      <button
        className="button button-quiet button-small"
        disabled={pending}
        onClick={() => setAsking(false)}
        type="button"
      >
        {common("cancel")}
      </button>
    </span>
  );
}
