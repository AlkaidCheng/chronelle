import type { ReactNode } from "react";

import { WorkspaceShell } from "../../components/workspace-shell";

/**
 * Every signed-in page lives in this route group, so each one gets the rail,
 * the session gate, and the command scope without a layout of its own.
 */
export default function WorkspaceLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
