"use client";

import { useEffect, useRef } from "react";
import { useAuthSession } from "./auth-session";

export function useSessionDialog(onClose: () => void) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { credential } = useAuthSession();
  const identity = useRef(credential);

  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
      else document.getElementById("workspace-content")?.focus();
    };
  }, []);

  useEffect(() => {
    if (
      credential?.workspaceId !== identity.current?.workspaceId ||
      credential?.accessToken !== identity.current?.accessToken
    )
      onClose();
  }, [credential, onClose]);

  return dialog;
}
