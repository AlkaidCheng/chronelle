"use client";

import { ApiClientError } from "@chronelle/api-client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";

import { useAuthSession } from "../lib/auth-session";
import { useAdoptAccountLocale, useSessionQuery } from "../lib/queries";
import {
  DisplayPreferencesProvider,
  timePreferencesOf,
} from "../lib/use-display-preferences";
import { AccountMenu } from "./account-menu";
import { WorkspaceCommandProvider } from "./context-commands";
import { ErrorNotice, LoadingState } from "./feedback";
import { MoreMenu } from "./more-menu";
import { RailCollections } from "./rail-collections";
import { SearchEntry } from "./search-entry";

export function WorkspaceShell({ children }: { readonly children: ReactNode }) {
  const { credential, isHydrated, signOut, switchWorkspace } = useAuthSession();
  const router = useRouter();
  const pathname = usePathname();
  const session = useSessionQuery();
  const t = useTranslations("nav");
  const adoptLocale = useAdoptAccountLocale();
  const [customizing, setCustomizing] = useState(false);

  useEffect(() => {
    if (isHydrated && credential === null) {
      router.replace("/sign-in");
    }
  }, [credential, isHydrated, router]);

  // A session found through the cookie has not passed through sign-in, so
  // the browser's language and the account's are reconciled here.
  const accountLocale = session.data?.user.locale;
  useEffect(() => {
    if (accountLocale !== undefined) adoptLocale({ locale: accountLocale });
  }, [accountLocale, adoptLocale]);

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
              <SearchEntry
                workspaceName={currentSession.workspace.displayName}
                current={pathname.startsWith("/search")}
              />
              <RailCollections
                pathname={pathname}
                customizing={customizing}
                onCustomize={setCustomizing}
              />
            </nav>
            <div className="sidebar-footer">
              <AccountMenu
                session={currentSession}
                onSwitchWorkspace={changeWorkspace}
                onSignOut={leaveWorkspace}
              />
              <MoreMenu onCustomize={() => setCustomizing(true)} />
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
