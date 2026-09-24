import type { WorkspaceLabels } from "../account/workspace-identity";
import type { getMessages } from "../i18n/catalog";

export function workspaceLabels(
  messages: ReturnType<typeof getMessages>,
): WorkspaceLabels {
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
