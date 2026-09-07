"use client";

import { ApiClientError } from "@chronelle/api-client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { useAuthSession } from "../lib/auth-session";
import { useSessionQuery } from "../lib/queries";
import { CalendarIcon, SearchIcon, SignOutIcon, TrashIcon } from "./icons";
import { ErrorNotice, LoadingState } from "./feedback";

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
          <Link
            aria-current={pathname.startsWith("/events") ? "page" : undefined}
            className={pathname.startsWith("/events") ? "active" : ""}
            href="/events"
          >
            <CalendarIcon />
            Events
          </Link>
          <Link
            aria-current={pathname.startsWith("/search") ? "page" : undefined}
            className={pathname.startsWith("/search") ? "active" : ""}
            href="/search"
          >
            <SearchIcon />
            Search
          </Link>
          <Link
            aria-current={pathname.startsWith("/trash") ? "page" : undefined}
            className={pathname.startsWith("/trash") ? "active" : ""}
            href="/trash"
          >
            <TrashIcon />
            Trash
          </Link>
        </nav>
        <label className="workspace-switcher" htmlFor="desktop-workspace">
          <span>Workspace</span>
          <select
            id="desktop-workspace"
            onChange={(event) => changeWorkspace(event.target.value)}
            value={activeWorkspaceId}
          >
            {currentSession.availableWorkspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.displayName}
              </option>
            ))}
          </select>
        </label>
        <div className="sidebar-footer">
          <div className="profile-mark" aria-hidden="true">
            {currentSession.user.displayName.slice(0, 1).toUpperCase()}
          </div>
          <div className="profile-copy">
            <strong>{currentSession.user.displayName}</strong>
            <span>{currentSession.workspace.displayName}</span>
          </div>
          <button
            aria-label="Sign out"
            className="icon-button"
            onClick={leaveWorkspace}
            title="Sign out"
            type="button"
          >
            <SignOutIcon />
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="workspace-topbar">
          <span>{currentSession.workspace.displayName}</span>
          <span className="environment-label">Development workspace</span>
        </header>
        <header className="mobile-header">
          <Link className="brand" href="/events">
            <span className="brand-mark">C</span>
            <span>Chronelle</span>
          </Link>
          <details
            className="mobile-account"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}
          >
            <summary aria-label="Account and workspace">
              <span className="profile-mark" aria-hidden="true">
                {currentSession.user.displayName.slice(0, 1).toUpperCase()}
              </span>
            </summary>
            <div className="account-popover">
              <strong>{currentSession.user.displayName}</strong>
              <span className="environment-label">Development workspace</span>
              <label className="mobile-workspace-switcher">
                <span className="visually-hidden">Workspace</span>
                <select
                  aria-label="Workspace"
                  onChange={(event) => changeWorkspace(event.target.value)}
                  value={activeWorkspaceId}
                >
                  {currentSession.availableWorkspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button button-secondary button-wide"
                onClick={leaveWorkspace}
                type="button"
              >
                <SignOutIcon />
                Sign out
              </button>
            </div>
          </details>
        </header>
        <div id="workspace-content" tabIndex={-1}>
          {children}
        </div>
      </div>
    </div>
  );
}
