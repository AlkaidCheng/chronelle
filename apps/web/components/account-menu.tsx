"use client";

import type { SessionResponse } from "@chronelle/schemas";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { personInitials } from "../lib/person-collection";
import { PeopleIcon, SettingsIcon, SignOutIcon } from "./icons";
import {
  focusFirstMenuItem,
  moveMenuFocus,
  useMenuDismissal,
} from "./quiet-menu";

interface AccountMenuProps {
  readonly session: SessionResponse;
  /** Friend requests waiting for an answer; shown on the Friends entry and as a dot on the profile block. */
  readonly pendingRequests?: number | undefined;
  readonly onSignOut: () => void;
}

/**
 * The sidebar profile block (the account's name and email) opens a menu
 * above it: the account, Friends (with the requests waiting), Settings,
 * and sign out. Escape or a press outside closes it and returns focus to
 * the profile block.
 */
export function AccountMenu({
  session,
  pendingRequests = 0,
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
          {personInitials(session.user.displayName)}
          {pendingRequests > 0 ? <span className="profile-dot" /> : null}
        </span>
        <span className="profile-copy">
          <strong>{session.user.displayName}</strong>
          <span>{session.user.email}</span>
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
          <Link
            role="menuitem"
            tabIndex={-1}
            className="quiet-menu-item"
            href="/friends"
            onClick={() => setOpen(false)}
          >
            <PeopleIcon />
            <span>{t("friends")}</span>
            {pendingRequests > 0 ? (
              <span className="menu-count">{pendingRequests}</span>
            ) : null}
          </Link>
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
