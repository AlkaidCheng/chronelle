"use client";

import type { SessionResponse } from "@chronelle/schemas";
import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSessionDialog } from "../lib/use-session-dialog";
import { AppearanceSettings } from "./appearance-settings";
import { MoreIcon, SignOutIcon } from "./icons";

interface WorkspaceUtilitiesProps {
  readonly session: SessionResponse;
  readonly onSwitchWorkspace: (workspaceId: string) => void;
  readonly onSignOut: () => void;
}

export function WorkspaceUtilities(props: WorkspaceUtilitiesProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
      >
        <MoreIcon />
        More
      </button>
      {open &&
        createPortal(
          <WorkspaceUtilitiesDialog
            {...props}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}

function WorkspaceUtilitiesDialog({
  session,
  onSwitchWorkspace,
  onSignOut,
  onClose,
}: WorkspaceUtilitiesProps & { readonly onClose: () => void }) {
  const dialog = useSessionDialog(onClose);
  const backdropPress = useRef(false);
  const id = useId();
  return (
    <dialog
      ref={dialog}
      className="event-create-dialog workspace-utilities-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        backdropPress.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (backdropPress.current && event.target === event.currentTarget)
          onClose();
        backdropPress.current = false;
      }}
    >
      <header className="event-create-header">
        <h2 id={`${id}-title`}>Workspace settings</h2>
        <button
          type="button"
          className="dialog-close"
          aria-label="Close workspace settings"
          onClick={onClose}
        >
          &#215;
        </button>
      </header>
      <div className="event-create-body workspace-utilities-body">
        <div className="workspace-account">
          <span className="profile-mark" aria-hidden="true">
            {session.user.displayName.slice(0, 1).toUpperCase()}
          </span>
          <strong>{session.user.displayName}</strong>
        </div>
        <label className="workspace-switcher">
          <span>Workspace</span>
          <select
            value={session.workspace.id}
            onChange={(event) => {
              if (event.target.value === session.workspace.id) return;
              onClose();
              onSwitchWorkspace(event.target.value);
            }}
          >
            {session.availableWorkspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.displayName}
              </option>
            ))}
          </select>
        </label>
        <section aria-labelledby={`${id}-appearance`}>
          <h3 id={`${id}-appearance`}>Appearance</h3>
          <p>Display settings apply only to this browser.</p>
          <AppearanceSettings />
        </section>
      </div>
      <footer className="event-create-footer">
        <button
          className="button button-secondary"
          type="button"
          onClick={() => {
            onClose();
            onSignOut();
          }}
        >
          <SignOutIcon />
          Sign out
        </button>
      </footer>
    </dialog>
  );
}
