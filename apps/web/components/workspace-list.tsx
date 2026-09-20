"use client";

import type { AccessibleWorkspace, SessionResponse } from "@chronelle/schemas";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode, RefObject } from "react";
import { personInitials } from "../lib/person-collection";
import { formatRelativeTime } from "../lib/relative-time";
import {
  groupWorkspaces,
  matchWorkspaces,
  searchThreshold,
} from "../lib/workspace-recency";
import { CheckIcon, SearchIcon } from "./icons";

/** The workspaces the switcher lists: memberships alone, since a share reaches the account's own Events list. */
export function switchableWorkspaces(
  session: SessionResponse,
): readonly AccessibleWorkspace[] {
  return session.availableWorkspaces.filter(
    (workspace) => workspace.role !== null,
  );
}

interface WorkspaceListProps {
  readonly session: SessionResponse;
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly onChoose: (workspace: AccessibleWorkspace) => void;
  /** Runs when Members is chosen, before the page opens. */
  readonly onMembers: () => void;
  readonly searchRef?: RefObject<HTMLInputElement | null> | undefined;
  /** Rendered after Members at the foot: the shortcut on a keyboard device. */
  readonly foot?: ReactNode;
}

/**
 * The switcher's content: a search field once the list is long, the
 * account's own workspace first, then the ones shared with it by when they
 * were last opened (the owner, the account's role, and when it was opened
 * under each), the current one ticked, and Members at the foot. The rail's
 * popover and the phone's sheet both show it.
 */
export function WorkspaceList({
  session,
  query,
  onQuery,
  onChoose,
  onMembers,
  searchRef,
  foot,
}: WorkspaceListProps) {
  const t = useTranslations("workspace");
  const roles = useTranslations("members.roles");
  const locale = useLocale();
  const memberships = switchableWorkspaces(session);
  const groups = groupWorkspaces(
    matchWorkspaces(memberships, query),
    session.user.workspaceRecency,
  );
  const empty = groups.yours.length + groups.shared.length === 0;

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
        onClick={() => onChoose(workspace)}
      >
        <span className="workspace-mark" aria-hidden="true">
          {personInitials(workspace.displayName)}
        </span>
        <span className="workspace-item-copy">
          <span className="workspace-item-name">{workspace.displayName}</span>
          <small>{details.join(" · ")}</small>
        </span>
        {current ? <CheckIcon className="quiet-menu-check" /> : null}
      </button>
    );
  };

  return (
    <>
      {memberships.length > searchThreshold ? (
        <label className="workspace-search">
          <SearchIcon className="workspace-search-icon" />
          <input
            ref={searchRef}
            className="workspace-search-input"
            type="search"
            aria-label={t("find")}
            placeholder={t("find")}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
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
          onClick={onMembers}
        >
          <span>{t("members")}</span>
        </Link>
        {foot}
      </div>
    </>
  );
}
