"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

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
}: {
  readonly className?: string;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onConfirm: () => void;
  readonly pending?: boolean;
  readonly pendingLabel?: string;
  readonly question: string;
}) {
  const common = useTranslations("common");
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button
        className={className}
        disabled={disabled}
        onClick={() => setAsking(true)}
        type="button"
      >
        {label}
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
