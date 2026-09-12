"use client";

import { useEffect, useRef, useState } from "react";

/** Keeps the editor mounted while confirming dismissal of unsaved fields. */
export function useDiscardConfirmation({
  isDirty,
  isPending,
  onClose,
}: {
  readonly isDirty: boolean;
  readonly isPending: boolean;
  readonly onClose: () => void;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const keepEditingButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isConfirming) keepEditingButton.current?.focus();
    else if (returnFocus.current?.isConnected) returnFocus.current.focus();
  }, [isConfirming]);

  function requestClose() {
    if (isPending) return;
    if (isConfirming) setIsConfirming(false);
    else if (isDirty) {
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setIsConfirming(true);
    } else onClose();
  }

  return {
    isConfirming,
    keepEditingButton,
    requestClose,
    keepEditing: () => setIsConfirming(false),
  };
}
