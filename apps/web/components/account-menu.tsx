"use client";

import type { SessionResponse } from "@chronelle/schemas";
import { useEffect, useId, useRef, useState } from "react";
import { SignOutIcon } from "./icons";

interface AccountMenuProps {
  readonly session: SessionResponse;
  readonly onSignOut: () => void;
}

/**
 * Sidebar account disclosure: the profile block is a button that reveals the
 * account actions beneath it. Escape or a press outside collapses it and
 * returns focus to the profile button.
 */
export function AccountMenu({ session, onSignOut }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (!root.current?.contains(document.activeElement)) return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && root.current?.contains(event.target))
        return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={root}>
      <button
        type="button"
        className="account-trigger"
        aria-expanded={open}
        aria-controls={`${id}-actions`}
        onClick={() => setOpen((current) => !current)}
        ref={trigger}
      >
        <span className="profile-mark" aria-hidden="true">
          {session.user.displayName.slice(0, 1).toUpperCase()}
        </span>
        <span className="profile-copy">
          <strong>{session.user.displayName}</strong>
          <span>{session.workspace.displayName}</span>
        </span>
      </button>
      <div className="account-actions" id={`${id}-actions`} hidden={!open}>
        {open && (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <SignOutIcon />
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
