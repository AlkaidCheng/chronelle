"use client";

import type { AccessibleWorkspace, SessionResponse } from "@livtales/schemas";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { formatRelativeTime } from "../lib/relative-time";
import { useWorkspaceIdentity } from "../lib/use-workspace-identity";
import {
  groupWorkspaces,
  matchWorkspaces,
  searchThreshold,
} from "../lib/workspace-recency";
import { CheckIcon, ChevronLeftIcon, SearchIcon } from "./icons";
import { WorkspaceMark } from "./workspace-mark";

/** The keys, as `aria-keyshortcuts` names them, that open the switcher on either platform. */
export const switchWorkspaceShortcutKeys = "Meta+Shift+K Control+Shift+K";

interface WorkspaceSwitcherListProps {
  readonly session: SessionResponse;
  /** Chosen from the list; the current workspace closes the list without a switch. */
  readonly onChoose: (workspace: AccessibleWorkspace) => void;
  /** The way back to the menu this list opened from, as its first row; a sheet of its own has none. */
  readonly onBack?: (() => void) | undefined;
  /** Closes the menu the list lives in, after a link is followed. */
  readonly onClose: () => void;
}

/**
 * The switcher's list, inside a menu another control opens: the account's
 * own workspace first, then the ones shared with it by when they were
 * last opened (the owner's name as the title; the role and when it was
 * opened under it), the current one ticked; a search field narrows a list
 * longer than a few; Members at the foot opens the settings page. The
 * search field takes focus when it shows, else the current workspace.
 */
export function WorkspaceSwitcherList({
  session,
  onChoose,
  onBack,
  onClose,
}: WorkspaceSwitcherListProps) {
  const [query, setQuery] = useState("");
  const t = useTranslations("workspace");
  const locale = useLocale();
  const identityOf = useWorkspaceIdentity(session);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  // The switcher lists memberships alone: a workspace reached through
  // shares has no role here, and its shared events show in the account's
  // own Events list instead.
  const memberships = session.availableWorkspaces.filter(
    (workspace) => workspace.role !== null,
  );
  const searchable = memberships.length > searchThreshold;
  const groups = groupWorkspaces(
    matchWorkspaces(memberships, query),
    session.user.workspaceRecency,
  );
  const empty = groups.yours.length + groups.shared.length === 0;

  useEffect(() => {
    if (searchable) {
      search.current?.focus();
      return;
    }
    const current = root.current?.querySelector<HTMLElement>(
      '[role="menuitemradio"][aria-checked="true"]',
    );
    (
      current ?? root.current?.querySelector<HTMLElement>('[role^="menuitem"]')
    )?.focus();
  }, [searchable]);

  const row = (workspace: AccessibleWorkspace) => {
    const current = workspace.id === session.workspace.id;
    const identity = identityOf(workspace);
    const opened = session.user.workspaceRecency[workspace.id];
    const details = [
      identity.detail,
      workspace.personal || opened === undefined
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
        onClick={() => onChoose(workspace)}
      >
        <WorkspaceMark mark={identity.mark} />
        <span className="workspace-item-copy">
          <span className="workspace-item-name">{identity.title}</span>
          {details.length > 0 ? (
            <small>{details.join(" \u00b7 ")}</small>
          ) : null}
        </span>
        {current ? <CheckIcon className="quiet-menu-check" /> : null}
      </button>
    );
  };

  return (
    <div className="workspace-switcher-list" ref={root}>
      {onBack === undefined ? null : (
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="quiet-menu-item workspace-back"
          onClick={onBack}
        >
          <ChevronLeftIcon />
          <span>{t("section")}</span>
        </button>
      )}
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
          onClick={onClose}
        >
          <span>{t("members")}</span>
        </Link>
        <kbd className="workspace-shortcut keyboard-only">
          <Shortcut />
        </kbd>
      </div>
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
