import type { AccessibleWorkspace, SessionResponse } from "@chronelle/schemas";

type WorkspaceRole = NonNullable<AccessibleWorkspace["role"]>;

/** The home symbol for the account's own workspace, else the owner's initials. */
export type WorkspaceMark =
  | { readonly kind: "home" }
  | { readonly kind: "initials"; readonly text: string };

/** How a workspace reads in the sidebar, account menu, and workspace picker. */
export interface WorkspaceIdentity {
  readonly title: string;
  /** The account's access as a label; null in its own workspace or with shares alone. */
  readonly access: string | null;
  /** The owner of a renamed workspace and the access, joined; null when empty. */
  readonly detail: string | null;
  readonly mark: WorkspaceMark;
}

/** The words the identity needs from the catalog. */
export interface WorkspaceLabels {
  readonly myWorkspace: string;
  readonly access: (role: WorkspaceRole) => string;
}

/** A name's initial: the first character of a CJK name, else up to two initials. */
export function personInitials(name: string): string {
  const trimmed = name.trim();
  const first = [...trimmed][0];
  if (first === undefined) return "?";
  if (
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
      first,
    )
  )
    return first;
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => [...part][0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The account's own workspace reads "my workspace"; a shared one reads its
 * owner's name with the account's access, or, when the owner renamed it, its
 * name with the owner and the access.
 */
export function workspaceIdentity(
  workspace: AccessibleWorkspace,
  labels: WorkspaceLabels,
): WorkspaceIdentity {
  if (workspace.personal) {
    return {
      title: labels.myWorkspace,
      access: null,
      detail: null,
      mark: { kind: "home" },
    };
  }
  const owner = workspace.ownerDisplayName;
  const access = workspace.role === null ? null : labels.access(workspace.role);
  const renamed =
    owner !== null && workspace.displayName !== `${owner}'s workspace`;
  const detail = [renamed ? owner : null, access]
    .filter((part): part is string => part !== null)
    .join(" · ");
  return {
    title: owner !== null && !renamed ? owner : workspace.displayName,
    access,
    detail: detail === "" ? null : detail,
    mark: {
      kind: "initials",
      text: personInitials(owner ?? workspace.displayName),
    },
  };
}

/** The identity of the session's active workspace; null when the session does not list it. */
export function activeWorkspaceIdentity(
  session: Pick<SessionResponse, "availableWorkspaces" | "workspace">,
  labels: WorkspaceLabels,
): WorkspaceIdentity | null {
  const workspace = session.availableWorkspaces.find(
    (candidate) => candidate.id === session.workspace.id,
  );
  return workspace === undefined ? null : workspaceIdentity(workspace, labels);
}

/** The line under the account's name: its username at home, else where it is. */
export function accountLine(
  username: string,
  workspace: AccessibleWorkspace,
  identity: WorkspaceIdentity,
): string {
  if (workspace.personal) return `@${username}`;
  return identity.access === null
    ? identity.title
    : `${identity.title} · ${identity.access}`;
}

/** Whether a workspace's title, owner, or access contains the query. */
export function matchesWorkspaceQuery(
  identity: WorkspaceIdentity,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return `${identity.title} ${identity.detail ?? ""}`
    .toLowerCase()
    .includes(needle);
}

/** Text around the first case-insensitive match of the query, for highlighting. */
export function splitMatch(
  text: string,
  query: string,
): readonly [before: string, match: string, after: string] {
  const needle = query.trim().toLowerCase();
  const index = needle === "" ? -1 : text.toLowerCase().indexOf(needle);
  if (index < 0) return [text, "", ""];
  return [
    text.slice(0, index),
    text.slice(index, index + needle.length),
    text.slice(index + needle.length),
  ];
}
