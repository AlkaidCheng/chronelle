import type { SessionResponse } from "@chronelle/schemas";

import {
  activeWorkspaceIdentity,
  type WorkspaceLabels,
} from "../account/workspace-identity";
import type { getMessages } from "../i18n/catalog";

type Messages = ReturnType<typeof getMessages>;

export function workspaceLabels(messages: Messages): WorkspaceLabels {
  return {
    myWorkspace: messages.myWorkspace,
    access: (role) =>
      role === "owner"
        ? messages.roleOwner
        : role === "editor"
          ? messages.roleEditor
          : messages.roleViewer,
  };
}

/** The active workspace's title as the account menu reads it, else its stored name. */
export function activeWorkspaceTitle(
  session: Pick<SessionResponse, "availableWorkspaces" | "workspace">,
  messages: Messages,
): string {
  return (
    activeWorkspaceIdentity(session, workspaceLabels(messages))?.title ??
    session.workspace.displayName
  );
}
