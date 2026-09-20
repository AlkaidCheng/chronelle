"use client";

import type { AccessibleWorkspace, SessionResponse } from "@chronelle/schemas";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { canSwitchWorkspace, isSwitchWorkspaceKeys } from "../lib/keyboard";
import { personInitials } from "../lib/person-collection";
import { useCurrentWorkspaceIdentity } from "../lib/use-workspace-identity";
import { AccountMenuItems } from "./account-menu";
import { BottomSheet } from "./bottom-sheet";
import { MenuIcon } from "./icons";
import { useInstallControl } from "./install-app";
import { MoreMenuItems } from "./more-menu";
import { moveMenuFocus } from "./quiet-menu";
import { RailCollections } from "./rail-collections";
import { SearchEntry } from "./search-entry";
import { ThemeControls } from "./theme-controls";
import { WorkspaceMark } from "./workspace-mark";
import {
  WorkspaceSwitcherList,
  switchWorkspaceShortcutKeys,
} from "./workspace-switcher";

type Sheet = "drawer" | "workspace" | "account" | "theme";

/**
 * The phone's app bar and what opens from it. At the left the menu
 * control opens the sidebar as a drawer: the brand, then the collections
 * (Search, Events, Tasks, People) in the account's order; a long press on
 * one enters customization, and the Collections header offers Done until
 * it is left. Beside it the current workspace as a mark and its name (the
 * home symbol and "Personal" for the account's own, the owner's initials
 * and name for one shared with it), opening the switcher as a sheet from
 * the bottom; at the right the account's avatar, opening the account
 * sheet: Friends, Settings, Sign out, and what More offers under them
 * (Trash, Theme, Customize sidebar, Help, and Keyboard shortcuts on a
 * keyboard device). Cmd/Ctrl+Shift+K opens the switcher sheet as it opens
 * the rail's list.
 */
export function PhoneChrome({
  session,
  pathname,
  pendingRequests = 0,
  customizing,
  onCustomize,
  onSwitch,
  onSignOut,
}: {
  readonly session: SessionResponse;
  readonly pathname: string;
  readonly pendingRequests?: number | undefined;
  readonly customizing: boolean;
  readonly onCustomize: (customizing: boolean) => void;
  readonly onSwitch: (workspaceId: string) => void;
  readonly onSignOut: () => void;
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const t = useTranslations("workspace");
  const account = useTranslations("account");
  const nav = useTranslations("nav");
  const theme = useTranslations("theme");
  const install = useInstallControl();
  const identity = useCurrentWorkspaceIdentity(session);
  const workspaceMenu = useRef<HTMLDivElement>(null);
  const accountMenu = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setSheet(null), []);
  const closeDrawer = useCallback(() => {
    setSheet(null);
    onCustomize(false);
  }, [onCustomize]);

  // Cmd/Ctrl+Shift+K toggles the switcher sheet; pressed inside it, closes it.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        sheet === "workspace" &&
        event.target instanceof Node &&
        (workspaceMenu.current?.contains(event.target) ?? false) &&
        isSwitchWorkspaceKeys(event)
      ) {
        event.preventDefault();
        setSheet(null);
        return;
      }
      if (!canSwitchWorkspace(event)) return;
      event.preventDefault();
      setSheet((open) => (open === "workspace" ? null : "workspace"));
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sheet]);

  // The account sheet opens on Friends; the switcher's list places its own focus.
  useEffect(() => {
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
      event.target instanceof HTMLInputElement &&
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
          className="phone-menu"
          aria-label={nav("menu")}
          aria-haspopup="dialog"
          aria-expanded={sheet === "drawer"}
          onClick={() =>
            setSheet((open) => (open === "drawer" ? null : "drawer"))
          }
        >
          <MenuIcon />
        </button>
        <button
          type="button"
          className="phone-workspace"
          aria-haspopup="dialog"
          aria-expanded={sheet === "workspace"}
          aria-keyshortcuts={switchWorkspaceShortcutKeys}
          aria-label={`${t("section")}: ${identity.title}`}
          onClick={() =>
            setSheet((open) => (open === "workspace" ? null : "workspace"))
          }
        >
          <WorkspaceMark mark={identity.mark} />
          <span className="phone-workspace-name">{identity.title}</span>
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
      <PhoneDrawer open={sheet === "drawer"} onClose={closeDrawer}>
        <div className="sidebar-head">
          <Link className="brand" href="/events" onClick={closeDrawer}>
            <span className="brand-mark">C</span>
            <span>Chronelle</span>
          </Link>
          <button
            type="button"
            className="icon-control icon-control-quiet phone-drawer-close"
            aria-label={nav("menu")}
            onClick={closeDrawer}
          >
            <span aria-hidden="true">&#215;</span>
          </button>
        </div>
        <nav
          aria-label={nav("workspaceNavigation")}
          className="workspace-nav"
          // A collection chosen from the drawer closes it; the palette
          // opens over the page once the drawer is gone.
          onClickCapture={(event) => {
            if (customizing) return;
            const target = event.target as HTMLElement;
            if (target.closest("a, button") !== null) setSheet(null);
          }}
        >
          <SearchEntry current={pathname.startsWith("/search")} />
          <RailCollections
            pathname={pathname}
            customizing={customizing}
            onCustomize={onCustomize}
            onLongPress={() => onCustomize(true)}
            headingDone
          />
        </nav>
      </PhoneDrawer>
      <BottomSheet
        open={sheet === "workspace"}
        label={t("switch")}
        onClose={close}
      >
        <div
          ref={workspaceMenu}
          role="menu"
          aria-label={t("switch")}
          className="sheet-menu"
          onKeyDown={onMenuKeyDown}
        >
          <WorkspaceSwitcherList
            session={session}
            onChoose={choose}
            onClose={close}
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
            onCustomize={() => {
              onCustomize(true);
              setSheet("drawer");
            }}
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

/**
 * The sidebar as a drawer from the left: a modal dialog with a scrim, so
 * focus stays inside while it is open and returns to the menu control;
 * Escape, the scrim, or its close control closes it.
 */
function PhoneDrawer({
  open,
  onClose,
  children,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const t = useTranslations("nav");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the dialog through its cancel event; the click closes on the scrim alone.
    <dialog
      ref={dialog}
      className="phone-drawer sidebar"
      aria-label={t("menu")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open ? children : null}
    </dialog>
  );
}
