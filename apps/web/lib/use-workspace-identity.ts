import type { AccessibleWorkspace, SessionResponse } from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import {
  type WorkspaceIdentity,
  currentWorkspace,
  workspaceIdentity,
} from "./workspace-identity";

/** How each of the session's workspaces reads, with the catalog's words. */
export function useWorkspaceIdentity(
  session: SessionResponse,
): (workspace: AccessibleWorkspace) => WorkspaceIdentity {
  const t = useTranslations("workspace");
  const roles = useTranslations("members.roles");
  const viewerName = session.user.displayName;
  const personal = t("personal");
  return useCallback(
    (workspace) =>
      workspaceIdentity(workspace, viewerName, {
        personal,
        role: (role) => roles(role),
      }),
    [personal, roles, viewerName],
  );
}

/** How the session's current workspace reads. */
export function useCurrentWorkspaceIdentity(
  session: SessionResponse,
): WorkspaceIdentity {
  return useWorkspaceIdentity(session)(currentWorkspace(session));
}
