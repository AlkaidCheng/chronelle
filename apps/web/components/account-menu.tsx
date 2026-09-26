"use client";

import type { AccessibleWorkspace, SessionResponse } from "@livtales/schemas";
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
import { currentWorkspace } from "../lib/workspace-identity";
import {
  ChevronRightIcon,
  PeopleIcon,
  SettingsIcon,
  SignOutIcon,
} from "./icons";
import { moveMenuFocus, useMenuDismissal } from "./quiet-menu";
import { SettingsLink } from "./settings-link";
import { useSpaceDialogs } from "./space-dialogs";
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
 * them; `onChoose` runs as an entry is taken, before it acts, and
 * `onSettings` in its place as Settings is: the surface closes and puts
 * focus where closing the Settings dialog returns it.
 */
export function AccountMenuItems({
  pendingRequests = 0,
  onSignOut,
  onChoose,
  onSettings,
}: {
  readonly pendingRequests?: number | undefined;
  readonly onSignOut: () => void;
  readonly onChoose: () => void;
  readonly onSettings: () => void;
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
      <SettingsLink
        role="menuitem"
        tabIndex={-1}
        className="quiet-menu-item"
        section="general"
        onOpen={onSettings}
      >
        <SettingsIcon />
        <span>{t("settings")}</span>
      </SettingsLink>
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
 * current space under it, opening a menu above it.
 * The menu's first row is the current space (its mark, name, and role),
 * which replaces the menu with the switcher's list until Escape leads
 * back; then Friends (with the requests waiting), Settings, and Sign out.
 * Cmd/Ctrl+Shift+K opens the switcher's level from anywhere in the app.
 * Escape or a press outside closes the menu and returns focus to the
 * block.
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
  const roles = useTranslations("members.roles");
  const spaceDialogs = useSpaceDialogs();
  const identity = useCurrentWorkspaceIdentity(session);
  const role = currentWorkspace(session).role;
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
              onNewSpace={spaceDialogs.openNewSpace}
              onManageSpace={spaceDialogs.openManageSpace}
              onClose={() => close(true)}
            />
          ) : (
            <>
              <button
                ref={switchItem}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-label={workspaceText("switchDots")}
                title={workspaceText("switchDots")}
                tabIndex={-1}
                className="quiet-menu-item workspace-item space-row"
                onClick={() => setLevel("workspace")}
              >
                <WorkspaceMark mark={identity.mark} />
                <span className="workspace-item-copy">
                  <span className="workspace-item-name">{identity.title}</span>
                  {role === null ? null : <small>{roles(role)}</small>}
                </span>
                <ChevronRightIcon className="quiet-menu-more" />
              </button>
              <hr className="quiet-menu-separator" />
              <AccountMenuItems
                pendingRequests={pendingRequests}
                onSignOut={onSignOut}
                onChoose={() => close(false)}
                onSettings={() => close(true)}
              />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
