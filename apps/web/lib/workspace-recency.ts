import type {
  AccessibleWorkspace,
  PreferencesRequest,
  WorkspaceRecency,
} from "@chronelle/schemas";

import { compareNames } from "./format";

/** How many workspaces the switcher lists before it offers a search field. */
export const searchThreshold = 6;

/** The stored instants with the request's workspaces replaced or dropped, as the account will read them. */
export function mergeWorkspaceRecency(
  current: WorkspaceRecency,
  changes: PreferencesRequest["workspaceRecency"],
): WorkspaceRecency {
  if (changes === undefined) return current;
  const next: Record<string, string> = { ...current };
  for (const [workspaceId, openedAt] of Object.entries(changes)) {
    if (openedAt === null) delete next[workspaceId];
    else next[workspaceId] = openedAt;
  }
  return next;
}

/** The switcher's two groups: the account's own workspace, then the rest by when they were last opened. */
export interface WorkspaceGroups {
  readonly yours: readonly AccessibleWorkspace[];
  readonly shared: readonly AccessibleWorkspace[];
}

/**
 * Splits the workspaces the account may enter into its own and the ones
 * shared with it, the shared ones most recently opened first and those
 * never opened after them by name.
 */
export function groupWorkspaces(
  workspaces: readonly AccessibleWorkspace[],
  recency: WorkspaceRecency,
): WorkspaceGroups {
  const openedAt = (workspace: AccessibleWorkspace) => {
    const instant = recency[workspace.id];
    return instant === undefined
      ? Number.NEGATIVE_INFINITY
      : Date.parse(instant);
  };
  const byRecency = (first: AccessibleWorkspace, second: AccessibleWorkspace) =>
    openedAt(second) - openedAt(first) ||
    compareNames(first.displayName, second.displayName);
  return {
    yours: workspaces.filter((workspace) => workspace.personal),
    shared: workspaces
      .filter((workspace) => !workspace.personal)
      .sort(byRecency),
  };
}

/** The workspaces whose name or owner's name contains the typed text, case-folded. */
export function matchWorkspaces(
  workspaces: readonly AccessibleWorkspace[],
  query: string,
): readonly AccessibleWorkspace[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return workspaces;
  return workspaces.filter(
    (workspace) =>
      workspace.displayName.toLocaleLowerCase().includes(needle) ||
      (workspace.ownerDisplayName ?? "").toLocaleLowerCase().includes(needle),
  );
}
