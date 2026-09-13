"use client";

import { useEffect, useId, useRef } from "react";
import { isDraftAccessError } from "./editor-draft-store";
import { useDiscardConfirmation } from "./use-discard-confirmation";
import { useSessionDialog } from "./use-session-dialog";

export function usePlanningEditorDialog({
  isDirty,
  mutation,
  onClose,
}: {
  readonly isDirty: boolean;
  readonly mutation: {
    readonly isPending: boolean;
    readonly isError: boolean;
    readonly error: unknown;
  };
  readonly onClose: () => void;
}) {
  const headingId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const submittedControl = useRef<HTMLElement | null>(null);
  const dialog = useSessionDialog(onClose);
  const discard = useDiscardConfirmation({
    isDirty,
    isPending: mutation.isPending,
    onClose,
  });
  useEffect(() => {
    nameInput.current?.focus();
  }, []);
  useEffect(() => {
    if (
      mutation.isError &&
      !mutation.isPending &&
      !isDraftAccessError(mutation.error)
    ) {
      if (
        document.activeElement === document.body ||
        document.activeElement === dialog.current
      )
        submittedControl.current?.focus();
      submittedControl.current = null;
    }
  }, [mutation.error, mutation.isError, mutation.isPending, dialog]);

  function rememberSubmit(form: HTMLFormElement) {
    submittedControl.current =
      document.activeElement instanceof HTMLElement &&
      form.contains(document.activeElement)
        ? document.activeElement
        : nameInput.current;
  }

  return { headingId, nameInput, dialog, rememberSubmit, ...discard };
}
