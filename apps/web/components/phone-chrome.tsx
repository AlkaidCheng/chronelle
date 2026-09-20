"use client";

import type { AccessibleWorkspace, SessionResponse } from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { personInitials } from "../lib/person-collection";
import { AccountMenuItems } from "./account-menu";
import { BottomSheet } from "./bottom-sheet";
import { HomeIcon } from "./icons";
import { useInstallControl } from "./install-app";
import { MoreMenuItems } from "./more-menu";
import { moveMenuFocus } from "./quiet-menu";
import { ThemeControls } from "./theme-controls";
import { WorkspaceList } from "./workspace-list";
import { useSwitcherShortcut } from "./workspace-switcher";

type Sheet = "workspace" | "account" | "theme";

/**
 * The phone's app bar and its sheets. At the left the current workspace
 * as a mark and its name (the home symbol and "Personal" for the
 * account's own workspace, the owner's initials and name for one shared
 * with it); at the right the account's avatar. Each opens a sheet from the
 * bottom of the screen: the switcher, or the account (Friends, Settings,
 * Sign out) with what More offers under it (Trash, Theme, Customize
 * sidebar, Help, and Keyboard shortcuts on a keyboard device).
 * Cmd/Ctrl+Shift+K opens the switcher sheet as it opens the rail's.
 */
export function PhoneChrome({
  session,
  pendingRequests = 0,
  onSwitch,
  onSignOut,
  onCustomize,
}: {
  readonly session: SessionResponse;
  readonly pendingRequests?: number | undefined;
  readonly onSwitch: (workspaceId: string) => void;
  readonly onSignOut: () => void;
  readonly onCustomize: () => void;
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [query, setQuery] = useState("");
  const t = useTranslations("workspace");
  const account = useTranslations("account");
  const nav = useTranslations("nav");
  const theme = useTranslations("theme");
  const install = useInstallControl();
  const workspaceMenu = useRef<HTMLDivElement>(null);
  const accountMenu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const current = session.availableWorkspaces.find(
    (workspace) => workspace.id === session.workspace.id,
  );
  const personal = current?.personal ?? false;
  const name = personal
    ? t("personal")
    : (current?.ownerDisplayName ?? session.workspace.displayName);

  const close = useCallback(() => {
    setSheet(null);
    setQuery("");
  }, []);
  const contains = useCallback(
    (target: Node) => workspaceMenu.current?.contains(target) ?? false,
    [],
  );
  const toggleSwitcher = useCallback(
    () => setSheet((open) => (open === "workspace" ? null : "workspace")),
    [],
  );
  useSwitcherShortcut(sheet === "workspace", contains, close, toggleSwitcher);

  // A sheet opens on its first entry: the switcher on the current
  // workspace (or its search field), the account on Friends.
  useEffect(() => {
    if (sheet === "workspace") {
      if (search.current !== null) {
        search.current.focus();
        return;
      }
      const menu = workspaceMenu.current;
      (
        menu?.querySelector<HTMLElement>(
          '[role="menuitemradio"][aria-checked="true"]',
        ) ?? menu?.querySelector<HTMLElement>('[role^="menuitem"]')
      )?.focus();
    }
    if (sheet === "account")
      accountMenu.current
        ?.querySelector<HTMLElement>('[role="menuitem"]')
        ?.focus();
  }, [sheet]);

  function choose(workspace: AccessibleWorkspace) {
    close();
    if (workspace.id !== session.workspace.id) onSwitch(workspace.id);
  }
  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (
      event.target === search.current &&
      (event.key === "Home" || event.key === "End")
    )
      return;
    moveMenuFocus(event, event.currentTarget);
  }

  return (
    <>
      <header className="phone-bar">
        <button
          type="button"
          className="phone-workspace"
          aria-haspopup="dialog"
          aria-expanded={sheet === "workspace"}
          aria-label={`${t("current")}: ${name}`}
          onClick={toggleSwitcher}
        >
          <span className="workspace-mark" aria-hidden="true">
            {personal ? (
              <HomeIcon />
            ) : (
              personInitials(current?.ownerDisplayName ?? name)
            )}
          </span>
          <span className="phone-workspace-name">{name}</span>
        </button>
        <button
          type="button"
          className="account-trigger phone-account"
          aria-haspopup="dialog"
          aria-expanded={sheet === "account"}
          aria-label={account("menu")}
          onClick={() =>
            setSheet((open) => (open === "account" ? null : "account"))
          }
        >
          <span className="profile-mark" aria-hidden="true">
            {personInitials(session.user.displayName)}
            {pendingRequests > 0 ? <span className="profile-dot" /> : null}
          </span>
        </button>
      </header>
      <BottomSheet
        open={sheet === "workspace"}
        label={t("switch")}
        onClose={close}
      >
        <div
          ref={workspaceMenu}
          role="menu"
          aria-label={t("switch")}
          className="sheet-menu workspace-switcher-list"
          onKeyDown={onMenuKeyDown}
        >
          <WorkspaceList
            session={session}
            query={query}
            onQuery={setQuery}
            onChoose={choose}
            onMembers={close}
            searchRef={search}
          />
        </div>
      </BottomSheet>
      <BottomSheet
        open={sheet === "account"}
        label={account("menu")}
        onClose={close}
      >
        <p className="quiet-menu-heading account-identity sheet-identity">
          <strong>{session.user.displayName}</strong>
          <span>{session.user.email}</span>
        </p>
        <div
          ref={accountMenu}
          role="menu"
          aria-label={account("menu")}
          className="sheet-menu"
          onKeyDown={onMenuKeyDown}
        >
          <AccountMenuItems
            pendingRequests={pendingRequests}
            onSignOut={onSignOut}
            onChoose={close}
          />
        </div>
        <hr className="quiet-menu-separator" />
        <div
          role="menu"
          aria-label={nav("more")}
          className="sheet-menu"
          onKeyDown={onMenuKeyDown}
        >
          <MoreMenuItems
            onChoose={close}
            onTheme={() => setSheet("theme")}
            onCustomize={onCustomize}
            installMode={install.mode}
            onInstall={install.activate}
          />
        </div>
      </BottomSheet>
      <BottomSheet
        open={sheet === "theme"}
        label={theme("title")}
        onClose={close}
      >
        <div className="sheet-theme">
          <ThemeControls />
        </div>
      </BottomSheet>
      {install.steps}
    </>
  );
}
