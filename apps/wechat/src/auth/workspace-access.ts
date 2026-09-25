import type { AccessibleWorkspace, SessionResponse } from "@livtales/schemas";

type WorkspaceAccessSession = Pick<
  SessionResponse,
  "availableWorkspaces" | "workspace"
>;

/** The account's role in the active workspace; null when it has none. */
export function activeWorkspaceRole(
  session: WorkspaceAccessSession,
): AccessibleWorkspace["role"] {
  return (
    session.availableWorkspaces.find(
      (workspace) => workspace.id === session.workspace.id,
    )?.role ?? null
  );
}

export function canCreateInActiveWorkspace(
  session: WorkspaceAccessSession,
): boolean {
  const role = activeWorkspaceRole(session);
  return role === "owner" || role === "editor";
}
