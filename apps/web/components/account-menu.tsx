"use client";

import type { SessionResponse } from "@chronelle/schemas";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { CheckIcon, KeyIcon, SignOutIcon } from "./icons";

interface AccountMenuProps {
  readonly session: SessionResponse;
  readonly onSwitchWorkspace: (workspaceId: string) => void;
  readonly onSignOut: () => void;
}

/**
 * The sidebar profile block opens a menu above it: the account, the
 * workspaces the person can open, the password screen, and sign out. Escape
 * or a press outside closes it and returns focus to the profile block.
 */
export function AccountMenu({
  session,
  onSwitchWorkspace,
  onSignOut,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && root.current?.contains(event.target))
        return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={root}>
      <button
        type="button"
        className="account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
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
      {open ? (
        <div
          ref={menu}
          id={`${id}-menu`}
          role="menu"
          aria-label="Account"
          className="quiet-menu-list account-menu-list"
          onKeyDown={(event) => {
            const items = Array.from(
              menu.current?.querySelectorAll<HTMLElement>(
                '[role^="menuitem"]',
              ) ?? [],
            );
            const index = items.indexOf(document.activeElement as HTMLElement);
            const go = (next: number) => {
              event.preventDefault();
              items
                .at(((next % items.length) + items.length) % items.length)
                ?.focus();
            };
            if (event.key === "ArrowDown") go(index + 1);
            else if (event.key === "ArrowUp") go(index - 1);
            else if (event.key === "Home") go(0);
            else if (event.key === "End") go(items.length - 1);
            else if (event.key === "Tab") setOpen(false);
          }}
        >
          <p className="quiet-menu-heading account-identity">
            <strong>{session.user.displayName}</strong>
            <span>{session.user.email}</span>
          </p>
          <hr className="quiet-menu-separator" />
          <p className="quiet-menu-heading">Workspaces</p>
          {session.availableWorkspaces.map((workspace) => {
            const current = workspace.id === session.workspace.id;
            return (
              <button
                key={workspace.id}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                tabIndex={-1}
                className="quiet-menu-item"
                onClick={() => {
                  setOpen(false);
                  if (!current) onSwitchWorkspace(workspace.id);
                }}
              >
                <span>{workspace.displayName}</span>
                {current ? <CheckIcon className="quiet-menu-check" /> : null}
              </button>
            );
          })}
          <hr className="quiet-menu-separator" />
          <Link
            role="menuitem"
            tabIndex={-1}
            className="quiet-menu-item"
            href="/reset-password"
            onClick={() => setOpen(false)}
          >
            <KeyIcon />
            <span>Change password</span>
          </Link>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="quiet-menu-item"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <SignOutIcon />
            <span>Sign out</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
