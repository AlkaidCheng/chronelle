"use client";

import { ApiClientError } from "@chronelle/api-client";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { useAuthSession } from "../lib/auth-session";
import { useSessionQuery } from "../lib/queries";
import { CalendarIcon, SearchIcon } from "./icons";
import { ErrorNotice, LoadingState } from "./feedback";

export function WorkspaceShell({ children }: { readonly children: ReactNode }) {
  const { credential, isHydrated, signOut, switchWorkspace } = useAuthSession();
  const queryClient = useQueryClient();
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
      queryClient.clear();
      signOut();
      router.replace("/sign-in");
    }
    if (
      session.error instanceof ApiClientError &&
      session.error.code === "workspace_unavailable" &&
      credential !== null &&
      credential.workspaceId !== credential.homeWorkspaceId
    ) {
      queryClient.clear();
      switchWorkspace(credential.homeWorkspaceId);
      router.replace("/events");
    }
  }, [
    credential,
    queryClient,
    router,
    session.error,
    signOut,
    switchWorkspace,
  ]);

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
  function changeWorkspace(workspaceId: string) {
    if (workspaceId === activeWorkspaceId) {
      return;
    }
    queryClient.clear();
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
            className={pathname.startsWith("/events") ? "active" : ""}
            href="/events"
          >
            <CalendarIcon />
            Events
          </Link>
          <Link
            className={pathname.startsWith("/search") ? "active" : ""}
            href="/search"
          >
            <SearchIcon />
            Search
          </Link>
          <Link
            className={pathname.startsWith("/trash") ? "active" : ""}
            href="/trash"
          >
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
            onClick={() => {
              queryClient.clear();
              signOut();
              router.replace("/sign-in");
            }}
            title="Sign out"
            type="button"
          >
            -&gt;
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="mobile-header">
          <Link className="brand" href="/events">
            <span className="brand-mark">C</span>
            <span>Chronelle</span>
          </Link>
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
        </header>
        <div id="workspace-content" tabIndex={-1}>
          {children}
        </div>
      </div>
    </div>
  );
}
