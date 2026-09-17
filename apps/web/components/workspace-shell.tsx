"use client";

import { ApiClientError } from "@chronelle/api-client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect } from "react";

import { useAuthSession } from "../lib/auth-session";
import { useSessionQuery } from "../lib/queries";
import {
  DisplayPreferencesProvider,
  timePreferencesOf,
} from "../lib/use-display-preferences";
import { AccountMenu } from "./account-menu";
import { WorkspaceCommandProvider } from "./context-commands";
import { ErrorNotice, LoadingState } from "./feedback";
import { SearchEntry } from "./search-entry";
import { ThemePanel } from "./theme-panel";
import { workspaceDestinations } from "./workspace-navigation";

export function WorkspaceShell({ children }: { readonly children: ReactNode }) {
  const { credential, isHydrated, signOut, switchWorkspace } = useAuthSession();
  const router = useRouter();
  const pathname = usePathname();
  const session = useSessionQuery();
  const t = useTranslations("nav");

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
        <LoadingState label={t("openingWorkspace")} />
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
    <DisplayPreferencesProvider
      preferences={timePreferencesOf(currentSession.user)}
    >
      <WorkspaceCommandProvider pathname={pathname}>
        <div className="workspace-shell">
          <a className="skip-link" href="#workspace-content">
            {t("skipToContent")}
          </a>
          <aside className="sidebar">
            <Link className="brand" href="/events">
              <span className="brand-mark">C</span>
              <span>Chronelle</span>
            </Link>
            <nav
              aria-label={t("workspaceNavigation")}
              className="workspace-nav"
            >
              {workspaceDestinations.map((destination) =>
                destination.href === "/search" ? (
                  <SearchEntry
                    key={destination.href}
                    workspaceName={currentSession.workspace.displayName}
                    current={pathname.startsWith(destination.href)}
                  />
                ) : (
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
                    {t(destination.key)}
                  </Link>
                ),
              )}
            </nav>
            <div className="sidebar-footer">
              <ThemePanel />
              <AccountMenu
                session={currentSession}
                onSwitchWorkspace={changeWorkspace}
                onSignOut={leaveWorkspace}
              />
            </div>
          </aside>
          <div className="workspace-main">
            <div id="workspace-content" tabIndex={-1}>
              {children}
            </div>
          </div>
        </div>
      </WorkspaceCommandProvider>
    </DisplayPreferencesProvider>
  );
}
