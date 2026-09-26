"use client";

import type { AccessibleWorkspace, SessionResponse } from "@livtales/schemas";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { formatRelativeTime } from "../lib/relative-time";
import { useWorkspaceIdentity } from "../lib/use-workspace-identity";
import { groupWorkspaces, matchWorkspaces } from "../lib/workspace-recency";
import { AddIcon, SearchIcon, SlidersIcon } from "./icons";
import { WorkspaceMark } from "./workspace-mark";

/** The keys, as `aria-keyshortcuts` names them, that open the switcher on either platform. */
export const switchWorkspaceShortcutKeys = "Meta+Shift+K Control+Shift+K";

interface WorkspaceSwitcherListProps {
  readonly session: SessionResponse;
  /** Chosen from the list; the current workspace closes the list without a switch. */
  readonly onChoose: (workspace: AccessibleWorkspace) => void;
  /** Opens New space; the list's menu closes first. */
  readonly onNewSpace: () => void;
  /** Opens Manage space for the current space; the list's menu closes first. */
  readonly onManageSpace: () => void;
  /** Closes the menu the list lives in. */
  readonly onClose: () => void;
}

/**
 * The switcher's list, inside a menu another control opens. Its top row is
 * the search field, which narrows the list by name or owner, with New space
 * and Manage space beside it as icons named by their tooltips. Under it the
 * account's own space, then the others by when they were last opened, each
 * with its name, when it was opened, and the account's role in it; the
 * current one carries the rail's active treatment. The list scrolls under
 * the pinned search field, and opens on the field with the current space in
 * view.
 */
export function WorkspaceSwitcherList({
  session,
  onChoose,
  onNewSpace,
  onManageSpace,
  onClose,
}: WorkspaceSwitcherListProps) {
  const [query, setQuery] = useState("");
  const t = useTranslations("workspace");
  const roles = useTranslations("members.roles");
  const locale = useLocale();
  const identityOf = useWorkspaceIdentity(session);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // The switcher lists memberships alone: a workspace reached through
  // shares has no role here, and its shared events show in the account's
  // own Events list instead.
  const memberships = session.availableWorkspaces.filter(
    (workspace) => workspace.role !== null,
  );
  const groups = groupWorkspaces(
    matchWorkspaces(memberships, query),
    session.user.workspaceRecency,
  );
  const listed = [...groups.yours, ...groups.shared];

  useEffect(() => {
    search.current?.focus();
    list.current
      ?.querySelector<HTMLElement>('[aria-checked="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, []);

  const row = (workspace: AccessibleWorkspace) => {
    const current = workspace.id === session.workspace.id;
    const identity = identityOf(workspace);
    const opened = session.user.workspaceRecency[workspace.id];
    return (
      <button
        key={workspace.id}
        type="button"
        role="menuitemradio"
        aria-checked={current}
        tabIndex={-1}
        className={`quiet-menu-item workspace-item${current ? " is-current" : ""}`}
        onClick={() => onChoose(workspace)}
      >
        <WorkspaceMark mark={identity.mark} />
        <span className="workspace-item-copy">
          <span className="workspace-item-name">{identity.title}</span>
          {workspace.personal || opened === undefined ? null : (
            <small>
              {t("opened", { when: formatRelativeTime(opened, locale) })}
            </small>
          )}
        </span>
        <span className="workspace-item-role">
          {workspace.personal || workspace.role === null
            ? ""
            : roles(workspace.role)}
        </span>
      </button>
    );
  };

  return (
    <div className="workspace-switcher-list">
      <div className="workspace-switcher-head">
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
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="workspace-switcher-action"
          aria-label={t("newSpace")}
          title={t("newSpace")}
          onClick={() => {
            onClose();
            onNewSpace();
          }}
        >
          <AddIcon className="workspace-switcher-icon" />
        </button>
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="workspace-switcher-action"
          aria-label={t("manageSpace")}
          title={t("manageSpace")}
          onClick={() => {
            onClose();
            onManageSpace();
          }}
        >
          <SlidersIcon className="workspace-switcher-icon" />
        </button>
      </div>
      <div className="workspace-switcher-scroll" ref={list}>
        {listed.map(row)}
      </div>
      {listed.length === 0 ? (
        <p className="workspace-empty">{t("noMatch")}</p>
      ) : null}
    </div>
  );
}
