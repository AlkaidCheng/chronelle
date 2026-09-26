import type { ReactNode } from "react";

import { WorkspaceShell } from "../../components/workspace-shell";
import { SettingsLayer } from "../../features/settings/settings-dialog";

/**
 * Every signed-in page lives in this route group, so each one gets the rail,
 * the session gate, and the command scope without a layout of its own, and
 * Settings opens over any of them from the address.
 */
export default function WorkspaceLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <WorkspaceShell>
      {children}
      <SettingsLayer />
    </WorkspaceShell>
  );
}
