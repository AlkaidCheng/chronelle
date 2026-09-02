"use client";

import { ApiClientError } from "@chronelle/api-client";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { useAuthSession } from "../lib/auth-session";
import { useSessionQuery } from "../lib/queries";
import { CalendarIcon } from "./icons";
import { ErrorNotice, LoadingState } from "./feedback";

export function WorkspaceShell({ children }: { readonly children: ReactNode }) {
  const { credential, isHydrated, signOut } = useAuthSession();
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
  }, [queryClient, router, session.error, signOut]);

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
  return (
    <div className="workspace-shell">
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
        </nav>
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
          <span>{currentSession.workspace.displayName}</span>
        </header>
        {children}
      </div>
    </div>
  );
}
