"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { useAuthSession } from "../../lib/auth-session";

export function RecoveryDialog({
  title,
  onClose,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
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
          Close
        </button>
      </header>
      {children}
    </dialog>
  );
}
