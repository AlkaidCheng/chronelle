"use client";

import { ApiClientError } from "@chronelle/api-client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { useAuthSession } from "../lib/auth-session";
import { useSessionQuery } from "../lib/queries";
import { WorkspaceHeader } from "./workspace-header";
import { workspaceDestinations } from "./workspace-navigation";
import { ErrorNotice, LoadingState } from "./feedback";
import { WorkspaceUtilities } from "./workspace-utilities";
import { WorkspaceCommandProvider } from "./context-commands";

export function WorkspaceShell({ children }: { readonly children: ReactNode }) {
  const { credential, isHydrated, signOut, switchWorkspace } = useAuthSession();
  const router = useRouter();
  const pathname = usePathname();
  const session = useSessionQuery();

  useEffect(() => {
    if (isHydrated && credential === null) {
      router.replace("/sign-in");
    }
  }, [credential, isHydrated, router]);

  useEffect(() => {
    if (
      session.error instanceof ApiClientError &&
      session.error.status === 401
    ) {
      signOut();
      router.replace("/sign-in");
    }
    if (
      session.error instanceof ApiClientError &&
      session.error.code === "workspace_unavailable" &&
      credential !== null &&
      credential.workspaceId !== credential.homeWorkspaceId
    ) {
      switchWorkspace(credential.homeWorkspaceId);
      router.replace("/events");
    }
  }, [credential, router, session.error, signOut, switchWorkspace]);

  if (!isHydrated || credential === null || session.isPending) {
    return (
      <main className="centered-page">
        <LoadingState label="Opening your workspace" />
      </main>
    );
  }

  if (session.isError) {
    return (
      <main className="centered-page">
        <ErrorNotice
          error={session.error}
          onRefresh={() => void session.refetch()}
        />
      </main>
    );
  }

  const currentSession = session.data;
  const activeWorkspaceId = credential.workspaceId;
  function leaveWorkspace() {
    signOut();
    router.replace("/sign-in");
  }
  function changeWorkspace(workspaceId: string) {
    if (workspaceId === activeWorkspaceId) {
      return;
    }
    switchWorkspace(workspaceId);
    router.replace("/events");
  }

  return (
    <WorkspaceCommandProvider pathname={pathname}>
      <div className="workspace-shell">
        <a className="skip-link" href="#workspace-content">
          Skip to content
        </a>
        <aside className="sidebar">
          <Link className="brand" href="/events">
            <span className="brand-mark">C</span>
            <span>Chronelle</span>
          </Link>
          <nav aria-label="Workspace navigation" className="workspace-nav">
            {workspaceDestinations.map((destination) => (
              <Link
                key={destination.href}
                href={destination.href}
                aria-current={
                  pathname.startsWith(destination.href) ? "page" : undefined
                }
                className={
                  pathname.startsWith(destination.href) ? "active" : ""
                }
              >
                <destination.icon />
                {destination.label}
              </Link>
            ))}
            <WorkspaceUtilities
              session={currentSession}
              onSwitchWorkspace={changeWorkspace}
              onSignOut={leaveWorkspace}
            />
          </nav>
          <div className="sidebar-footer">
            <div className="profile-mark" aria-hidden="true">
              {currentSession.user.displayName.slice(0, 1).toUpperCase()}
            </div>
            <div className="profile-copy">
              <strong>{currentSession.user.displayName}</strong>
              <span>{currentSession.workspace.displayName}</span>
            </div>
          </div>
        </aside>
        <div className="workspace-main">
          <WorkspaceHeader
            workspaceName={currentSession.workspace.displayName}
          />
          <div id="workspace-content" tabIndex={-1}>
            {children}
          </div>
        </div>
      </div>
    </WorkspaceCommandProvider>
  );
}
