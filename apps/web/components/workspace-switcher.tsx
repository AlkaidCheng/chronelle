"use client";

import type { AccessibleWorkspace, SessionResponse } from "@chronelle/schemas";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
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
import { formatRelativeTime } from "../lib/relative-time";
import {
  groupWorkspaces,
  matchWorkspaces,
  searchThreshold,
} from "../lib/workspace-recency";
import { CheckIcon, SearchIcon } from "./icons";
import { moveMenuFocus, useMenuDismissal } from "./quiet-menu";

/** The keys, as `aria-keyshortcuts` names them, that open the switcher on either platform. */
const shortcutKeys = "Meta+Shift+K Control+Shift+K";

interface WorkspaceSwitcherProps {
  readonly session: SessionResponse;
  readonly onSwitch: (workspaceId: string) => void;
}

/**
 * The current workspace as a control of its own in the rail: a mark, the
 * name, and a caret, opening the switcher above it. The list puts the
 * account's own workspace first, then the ones shared with it by when they
 * were last opened (the sharer's name, the account's role, and when it was
 * opened under each), the current one ticked; a search field narrows a
 * list longer than a few, Members at the foot opens the settings page, and
 * Cmd/Ctrl+Shift+K opens the switcher from anywhere in the workspace.
 * Escape or a press outside closes it and returns focus to the control.
 */
export function WorkspaceSwitcher({
  session,
  onSwitch,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const id = useId();
  const t = useTranslations("workspace");
  const roles = useTranslations("members.roles");
  const locale = useLocale();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const searchable = session.availableWorkspaces.length > searchThreshold;
  const groups = groupWorkspaces(
    matchWorkspaces(session.availableWorkspaces, query),
    session.user.workspaceRecency,
  );
  const empty = groups.yours.length + groups.shared.length === 0;

  useEffect(() => {
    if (!open) return;
    if (searchable) {
      search.current?.focus();
      return;
    }
    const current = menu.current?.querySelector<HTMLElement>(
      '[role="menuitemradio"][aria-checked="true"]',
    );
    (
      current ?? menu.current?.querySelector<HTMLElement>('[role^="menuitem"]')
    )?.focus();
  }, [open, searchable]);
  const contains = useCallback(
    (target: Node) => root.current?.contains(target) ?? false,
    [],
  );
  const close = useCallback((byKeyboard: boolean) => {
    setOpen(false);
    setQuery("");
    if (byKeyboard) trigger.current?.focus();
  }, []);
  useMenuDismissal(open, contains, close);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // The open switcher closes on its own keys from anywhere inside it,
      // its search field included.
      if (
        open &&
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
      setOpen((current) => !current);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close, contains, open]);

  function choose(workspace: AccessibleWorkspace) {
    close(false);
    if (workspace.id !== session.workspace.id) onSwitch(workspace.id);
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    // Home and End edit the search text; the list's items take the rest.
    if (
      event.target === search.current &&
      (event.key === "Home" || event.key === "End")
    )
      return;
    if (moveMenuFocus(event, menu.current) === "left") close(false);
  }

  const row = (workspace: AccessibleWorkspace) => {
    const current = workspace.id === session.workspace.id;
    const opened = session.user.workspaceRecency[workspace.id];
    const details = workspace.personal
      ? [t("personal")]
      : [
          workspace.ownerDisplayName,
          workspace.role === null ? null : roles(workspace.role),
          opened === undefined
            ? null
            : t("opened", { when: formatRelativeTime(opened, locale) }),
        ].filter((part): part is string => part !== null);
    return (
      <button
        key={workspace.id}
        type="button"
        role="menuitemradio"
        aria-checked={current}
        tabIndex={-1}
        className="quiet-menu-item workspace-item"
        onClick={() => choose(workspace)}
      >
        <span className="workspace-mark" aria-hidden="true">
          {personInitials(workspace.displayName)}
        </span>
        <span className="workspace-item-copy">
          <span className="workspace-item-name">{workspace.displayName}</span>
          <small>{details.join(" \u00b7 ")}</small>
        </span>
        {current ? <CheckIcon className="quiet-menu-check" /> : null}
      </button>
    );
  };

  return (
    <div className="workspace-switcher" ref={root}>
      <button
        type="button"
        className="workspace-line"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        aria-keyshortcuts={shortcutKeys}
        aria-label={`${t("current")}: ${session.workspace.displayName}`}
        onClick={() => (open ? close(false) : setOpen(true))}
        ref={trigger}
      >
        <span className="workspace-mark" aria-hidden="true">
          {personInitials(session.workspace.displayName)}
        </span>
        <span className="workspace-line-name">
          {session.workspace.displayName}
        </span>
        <svg
          aria-hidden="true"
          className="workspace-caret"
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
          aria-label={t("switch")}
          className="quiet-menu-list workspace-switcher-list"
          onKeyDown={onMenuKeyDown}
        >
          {searchable ? (
            <label className="workspace-search">
              <SearchIcon className="workspace-search-icon" />
              <input
                ref={search}
                className="workspace-search-input"
                type="search"
                aria-label={t("find")}
                placeholder={t("find")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          ) : null}
          {groups.yours.length > 0 ? (
            <>
              <p className="quiet-menu-heading">{t("yours")}</p>
              {groups.yours.map(row)}
            </>
          ) : null}
          {groups.shared.length > 0 ? (
            <>
              <p className="quiet-menu-heading">{t("shared")}</p>
              <div className="workspace-switcher-scroll">
                {groups.shared.map(row)}
              </div>
            </>
          ) : null}
          {empty ? <p className="workspace-empty">{t("noMatch")}</p> : null}
          <hr className="quiet-menu-separator" />
          <div className="workspace-switcher-foot">
            <Link
              role="menuitem"
              tabIndex={-1}
              className="quiet-menu-item"
              href="/settings/members"
              onClick={() => close(false)}
            >
              <span>{t("members")}</span>
            </Link>
            <kbd className="workspace-shortcut">
              <Shortcut />
            </kbd>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The shortcut as the viewer's platform names it: the modifier glyphs on a Mac, the key names elsewhere. */
function Shortcut() {
  const [mac, setMac] = useState<boolean | null>(null);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);
  if (mac === null) return null;
  return <>{mac ? "\u2318\u21e7K" : "Ctrl+Shift+K"}</>;
}
