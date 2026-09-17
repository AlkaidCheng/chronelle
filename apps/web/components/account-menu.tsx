"use client";

import type { SessionResponse } from "@chronelle/schemas";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CheckIcon, SettingsIcon, SignOutIcon } from "./icons";
import {
  focusFirstMenuItem,
  moveMenuFocus,
  useMenuDismissal,
} from "./quiet-menu";

interface AccountMenuProps {
  readonly session: SessionResponse;
  readonly onSwitchWorkspace: (workspaceId: string) => void;
  readonly onSignOut: () => void;
}

/**
 * The sidebar profile block opens a menu above it: the account, the
 * workspaces the person can open, Settings, and sign out. Escape or a
 * press outside closes it and returns focus to the profile block.
 */
export function AccountMenu({
  session,
  onSwitchWorkspace,
  onSignOut,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const t = useTranslations("account");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) focusFirstMenuItem(menu.current);
  }, [open]);
  const contains = useCallback(
    (target: Node) => root.current?.contains(target) ?? false,
    [],
  );
  const close = useCallback((byKeyboard: boolean) => {
    setOpen(false);
    if (byKeyboard) trigger.current?.focus();
  }, []);
  useMenuDismissal(open, contains, close);

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
          aria-label={t("menu")}
          className="quiet-menu-list account-menu-list"
          onKeyDown={(event) => {
            if (moveMenuFocus(event, menu.current) === "left") setOpen(false);
          }}
        >
          <p className="quiet-menu-heading account-identity">
            <strong>{session.user.displayName}</strong>
            <span>{session.user.email}</span>
          </p>
          <hr className="quiet-menu-separator" />
          <p className="quiet-menu-heading">{t("workspaces")}</p>
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
            href="/settings"
            onClick={() => setOpen(false)}
          >
            <SettingsIcon />
            <span>{t("settings")}</span>
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
            <span>{t("signOut")}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
