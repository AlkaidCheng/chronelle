import type { SessionResponse } from "@chronelle/schemas";

type WorkspaceAccessSession = Pick<
  SessionResponse,
  "availableWorkspaces" | "workspace"
>;

export function canCreateInActiveWorkspace(
  session: WorkspaceAccessSession,
): boolean {
  const role = session.availableWorkspaces.find(
    (workspace) => workspace.id === session.workspace.id,
  )?.role;
  return role === "owner" || role === "editor";
}
