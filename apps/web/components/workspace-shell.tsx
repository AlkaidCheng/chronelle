"use client";

import { ApiClientError } from "@livtales/api-client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";

import { useAuthSession } from "../lib/auth-session";
import { useFriendsQuery } from "../lib/friend-queries";
import {
  useAdoptAccountLocale,
  useNoteWorkspaceOpened,
  useSessionQuery,
} from "../lib/queries";
import { useContentUndoShortcut } from "../lib/use-content-undo-shortcut";
import {
  DisplayPreferencesProvider,
  timePreferencesOf,
} from "../lib/use-display-preferences";
import { useIsPhone } from "../lib/use-media";
import { AccountMenu } from "./account-menu";
import { BrandLogo } from "./brand-logo";
import { WorkspaceCommandProvider } from "./context-commands";
import { ErrorNotice, LoadingState } from "./feedback";
import { MoreMenu } from "./more-menu";
import { PhoneChrome } from "./phone-chrome";
import { RailCollections } from "./rail-collections";
import { SearchEntry } from "./search-entry";
import { SpaceDialogsProvider } from "./space-dialogs";
import {
  SidebarCollapseControl,
  SidebarExpandControl,
  useSidebar,
} from "./sidebar-toggle";

/** The workspace this tab has open, across the shell's remounts; null before sign-in and after sign-out. */
let openedWorkspace: string | null = null;

export function WorkspaceShell({ children }: { readonly children: ReactNode }) {
  const { credential, isHydrated, signOut, switchWorkspace } = useAuthSession();
  const router = useRouter();
  const pathname = usePathname();
  const session = useSessionQuery();
  const friends = useFriendsQuery();
  const t = useTranslations("nav");
  const adoptLocale = useAdoptAccountLocale();
  const noteWorkspaceOpened = useNoteWorkspaceOpened();
  const [customizing, setCustomizing] = useState(false);
  const sidebar = useSidebar();
  const phone = useIsPhone();
  useContentUndoShortcut();

  // Opening another workspace notes the moment on the account, so the
  // switcher lists it by recency on every device. The note is written
  // under the new session, after the switch has cancelled the old one's
  // requests and remounted the shell; the workspace a tab signs in with
  // is not a switch.
  const workspaceId = credential?.workspaceId ?? null;
  useEffect(() => {
    if (
      workspaceId !== null &&
      openedWorkspace !== null &&
      openedWorkspace !== workspaceId
    )
      noteWorkspaceOpened(workspaceId);
    openedWorkspace = workspaceId;
  }, [noteWorkspaceOpened, workspaceId]);

  useEffect(() => {
    if (isHydrated && credential === null) {
      router.replace("/sign-in");
    }
  }, [credential, isHydrated, router]);

  // A new account completes the Welcome step before anything else.
  const onboarded = session.data?.user.onboardedAt;
  useEffect(() => {
    if (onboarded === null) router.replace("/welcome");
  }, [onboarded, router]);

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
      openedWorkspace = null;
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

  if (
    !isHydrated ||
    credential === null ||
    session.isPending ||
    onboarded === null
  ) {
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
    openedWorkspace = null;
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
        <SpaceDialogsProvider
          session={currentSession}
          homeWorkspaceId={credential.homeWorkspaceId}
          onSwitch={changeWorkspace}
        >
          <div className="workspace-shell">
            <a className="skip-link" href="#workspace-content">
              {t("skipToContent")}
            </a>
            {phone ? (
              // The phone has no rail: the app bar's menu opens the sidebar
              // as a drawer, and its other controls open sheets.
              <PhoneChrome
                session={currentSession}
                pathname={pathname}
                pendingRequests={friends.data?.incoming.length ?? 0}
                customizing={customizing}
                onCustomize={setCustomizing}
                onSwitch={changeWorkspace}
                onSignOut={leaveWorkspace}
              />
            ) : (
              <aside className="sidebar" inert={sidebar.collapsed}>
                <div className="sidebar-head">
                  <Link className="brand" href="/events">
                    <BrandLogo />
                  </Link>
                  <SidebarCollapseControl sidebar={sidebar} />
                </div>
                <nav
                  aria-label={t("workspaceNavigation")}
                  className="workspace-nav"
                >
                  <SearchEntry current={pathname.startsWith("/search")} />
                  <RailCollections
                    pathname={pathname}
                    customizing={customizing}
                    onCustomize={setCustomizing}
                  />
                </nav>
                <div className="sidebar-footer">
                  <AccountMenu
                    session={currentSession}
                    pendingRequests={friends.data?.incoming.length ?? 0}
                    onSwitch={changeWorkspace}
                    onSignOut={leaveWorkspace}
                  />
                  <MoreMenu onCustomize={() => setCustomizing(true)} />
                </div>
              </aside>
            )}
            <div className="workspace-main">
              <SidebarExpandControl sidebar={sidebar} />
              <div id="workspace-content" tabIndex={-1}>
                {children}
              </div>
            </div>
          </div>
        </SpaceDialogsProvider>
      </WorkspaceCommandProvider>
    </DisplayPreferencesProvider>
  );
}
