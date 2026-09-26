import type { AccessibleWorkspace, SessionResponse } from "@livtales/schemas";

import { personInitials } from "./person-collection";

/**
 * A workspace's mark: the home symbol for the account's own workspace,
 * the initials of a named space, and the owner's initials for one still
 * called by its owner's name.
 */
export type WorkspaceMark =
  | { readonly kind: "home" }
  | { readonly kind: "initials"; readonly text: string };

/** How a workspace reads in the chrome: a title, a line under it, a mark. */
export interface WorkspaceIdentity {
  readonly title: string;
  readonly detail: string | null;
  readonly mark: WorkspaceMark;
}

/** A membership's role, as the switcher shows it under a shared workspace. */
export type WorkspaceRole = NonNullable<AccessibleWorkspace["role"]>;

/** The words the identity needs from the catalog. */
export interface WorkspaceLabels {
  /** The account's own workspace's title. */
  readonly personal: string;
  /** A role as the members list names it. */
  readonly role: (role: WorkspaceRole) => string;
}

/** Whether a workspace still carries the name it was created with, "<owner>'s workspace". */
export function isDefaultWorkspaceName(
  displayName: string,
  ownerDisplayName: string,
): boolean {
  return displayName === `${ownerDisplayName}'s workspace`;
}

/**
 * The account's own workspace reads "Personal" with the account's name
 * under it; a named space reads its name with its owner under it; one
 * still called by its owner's name reads that name with the account's role
 * under it.
 */
export function workspaceIdentity(
  workspace: AccessibleWorkspace,
  viewerName: string,
  labels: WorkspaceLabels,
): WorkspaceIdentity {
  if (workspace.personal)
    return {
      title: labels.personal,
      detail: viewerName,
      mark: { kind: "home" },
    };
  const owner = workspace.ownerDisplayName ?? workspace.displayName;
  if (
    workspace.ownerDisplayName !== null &&
    !isDefaultWorkspaceName(workspace.displayName, workspace.ownerDisplayName)
  )
    return {
      title: workspace.displayName,
      detail: owner,
      mark: { kind: "initials", text: personInitials(workspace.displayName) },
    };
  const mark: WorkspaceMark = { kind: "initials", text: personInitials(owner) };
  return {
    title: owner,
    detail: workspace.role === null ? null : labels.role(workspace.role),
    mark,
  };
}

/**
 * The session's current workspace as the switcher lists it. A workspace
 * the list does not carry (reached through an object's share alone)
 * stands in with its own name and no owner.
 */
export function currentWorkspace(
  session: SessionResponse,
): AccessibleWorkspace {
  return (
    session.availableWorkspaces.find(
      (workspace) => workspace.id === session.workspace.id,
    ) ?? {
      ...session.workspace,
      personal: false,
      ownerDisplayName: null,
      role: null,
    }
  );
}
