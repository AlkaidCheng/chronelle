"use client";

import type { AccessibleWorkspace, SessionResponse } from "@chronelle/schemas";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { canSwitchWorkspace, isSwitchWorkspaceKeys } from "../lib/keyboard";
import { personInitials } from "../lib/person-collection";
import { useCurrentWorkspaceIdentity } from "../lib/use-workspace-identity";
import {
  CheckIcon,
  ChevronRightIcon,
  PeopleIcon,
  SettingsIcon,
  SignOutIcon,
  SwitchIcon,
} from "./icons";
import { moveMenuFocus, useMenuDismissal } from "./quiet-menu";
import { WorkspaceMark } from "./workspace-mark";
import {
  WorkspaceSwitcherList,
  switchWorkspaceShortcutKeys,
} from "./workspace-switcher";

/** The menu's two levels: the account, and the switcher's list. */
type MenuLevel = "account" | "workspace";

interface AccountMenuProps {
  readonly session: SessionResponse;
  /** Friend requests waiting for an answer; shown on the Friends entry and as a dot on the profile block. */
  readonly pendingRequests?: number | undefined;
  readonly onSwitch: (workspaceId: string) => void;
  readonly onSignOut: () => void;
}

/**
 * The account's entries: Friends (with the requests waiting), Settings,
 * and sign out. The rail's menu and the phone's account sheet both list
 * them; `onChoose` runs as an entry is taken, before it acts.
 */
export function AccountMenuItems({
  pendingRequests = 0,
  onSignOut,
  onChoose,
}: {
  readonly pendingRequests?: number | undefined;
  readonly onSignOut: () => void;
  readonly onChoose: () => void;
}) {
  const t = useTranslations("account");
  return (
    <>
      <Link
        role="menuitem"
        tabIndex={-1}
        className="quiet-menu-item"
        href="/friends"
        onClick={onChoose}
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
        onClick={onChoose}
      >
        <SettingsIcon />
        <span>{t("settings")}</span>
      </Link>
      <hr className="quiet-menu-separator" />
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className="quiet-menu-item"
        onClick={() => {
          onChoose();
          onSignOut();
        }}
      >
        <SignOutIcon />
        <span>{t("signOut")}</span>
      </button>
    </>
  );
}

/**
 * The rail's foot as one block: the avatar, the account's name, and the
 * current workspace under it, opening a menu above it. The menu starts
 * with the account (its name and email), then the Workspace section (the
 * current one, ticked, and Switch workspace..., which replaces the menu
 * with the switcher's list until Escape or its first row leads back),
 * then Friends (with the requests waiting), Settings, and Sign out.
 * Cmd/Ctrl+Shift+K opens the switcher's level from anywhere in the
 * workspace. Escape or a press outside closes the menu and returns focus
 * to the block.
 */
export function AccountMenu({
  session,
  pendingRequests = 0,
  onSwitch,
  onSignOut,
}: AccountMenuProps) {
  const [level, setLevel] = useState<MenuLevel | null>(null);
  const id = useId();
  const t = useTranslations("account");
  const workspaceText = useTranslations("workspace");
  const identity = useCurrentWorkspaceIdentity(session);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const switchItem = useRef<HTMLButtonElement>(null);
  // Set when the switcher's list leads back, so the menu resumes at the
  // item that opened it rather than its first.
  const returning = useRef(false);
  const open = level !== null;

  useEffect(() => {
    if (level !== "account") return;
    const target = returning.current
      ? switchItem.current
      : menu.current?.querySelector<HTMLElement>('[role^="menuitem"]');
    returning.current = false;
    target?.focus();
  }, [level]);
  const back = useCallback(() => {
    returning.current = true;
    setLevel("account");
  }, []);
  const contains = useCallback(
    (target: Node) => root.current?.contains(target) ?? false,
    [],
  );
  const close = useCallback((byKeyboard: boolean) => {
    setLevel(null);
    if (byKeyboard) trigger.current?.focus();
  }, []);
  // Escape leaves the switcher's list for the menu it opened from, and
  // the menu for the block.
  const dismiss = useCallback(
    (byKeyboard: boolean) => {
      if (byKeyboard && level === "workspace") {
        back();
        return;
      }
      close(byKeyboard);
    },
    [back, close, level],
  );
  useMenuDismissal(open, contains, dismiss);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // The open switcher closes on its own keys from anywhere inside it,
      // its search field included.
      if (
        level === "workspace" &&
        event.target instanceof Node &&
        contains(event.target) &&
        isSwitchWorkspaceKeys(event)
      ) {
        event.preventDefault();
        close(true);
        return;
      }
      if (!canSwitchWorkspace(event)) return;
      event.preventDefault();
      setLevel((current) => (current === "workspace" ? null : "workspace"));
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close, contains, level]);

  function choose(workspace: AccessibleWorkspace) {
    close(false);
    if (workspace.id !== session.workspace.id) onSwitch(workspace.id);
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    // Home and End edit the search text; the list's items take the rest.
    if (
      event.target instanceof HTMLInputElement &&
      (event.key === "Home" || event.key === "End")
    )
      return;
    if (moveMenuFocus(event, menu.current) === "left") close(false);
  }

  return (
    <div className="account-menu" ref={root}>
      <button
        type="button"
        className="account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        aria-keyshortcuts={switchWorkspaceShortcutKeys}
        onClick={() => (open ? close(false) : setLevel("account"))}
        ref={trigger}
      >
        <span className="profile-mark" aria-hidden="true">
          {personInitials(session.user.displayName)}
          {pendingRequests > 0 ? <span className="profile-dot" /> : null}
        </span>
        <span className="profile-copy">
          <strong>{session.user.displayName}</strong>
          <span>{identity.title}</span>
        </span>
        <svg
          aria-hidden="true"
          className="account-caret"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path d="m6 10 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div
          ref={menu}
          id={`${id}-menu`}
          role="menu"
          aria-label={
            level === "workspace" ? workspaceText("switch") : t("menu")
          }
          className={`quiet-menu-list account-menu-list${level === "workspace" ? " is-workspace" : ""}`}
          onKeyDown={onMenuKeyDown}
        >
          {level === "workspace" ? (
            <WorkspaceSwitcherList
              session={session}
              onChoose={choose}
              onBack={back}
              onClose={() => close(false)}
            />
          ) : (
            <>
              <p className="quiet-menu-heading account-identity">
                <strong>{session.user.displayName}</strong>
                <span>{session.user.email}</span>
              </p>
              <hr className="quiet-menu-separator" />
              <p className="quiet-menu-heading">{workspaceText("section")}</p>
              <button
                type="button"
                role="menuitemradio"
                aria-checked="true"
                tabIndex={-1}
                className="quiet-menu-item workspace-item"
                onClick={() => close(false)}
              >
                <WorkspaceMark mark={identity.mark} />
                <span className="workspace-item-copy">
                  <span className="workspace-item-name">{identity.title}</span>
                  {identity.detail === null ? null : (
                    <small>{identity.detail}</small>
                  )}
                </span>
                <CheckIcon className="quiet-menu-check" />
              </button>
              <button
                ref={switchItem}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                tabIndex={-1}
                className="quiet-menu-item"
                onClick={() => setLevel("workspace")}
              >
                <SwitchIcon />
                <span>{workspaceText("switchDots")}</span>
                <ChevronRightIcon className="quiet-menu-more" />
              </button>
              <hr className="quiet-menu-separator" />
              <AccountMenuItems
                pendingRequests={pendingRequests}
                onSignOut={onSignOut}
                onChoose={() => close(false)}
              />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
