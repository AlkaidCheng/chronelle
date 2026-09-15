"use client";

import type { ApiCredential } from "@chronelle/api-client";

import { sessionPresent } from "./session-cookie";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// The session itself is the origin's httpOnly cookie; this tab keeps only the
// workspace it acts in, so a new tab discovers the session from the cookie.
const storageKey = "chronelle.session";

interface AuthCredential extends ApiCredential {
  readonly homeWorkspaceId: string;
}

interface AuthSessionContextValue {
  readonly credential: AuthCredential | null;
  readonly isHydrated: boolean;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly signOut: () => void;
  readonly startSession: (credential: ApiCredential) => void;
  readonly switchWorkspace: (workspaceId: string) => void;
}

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

function readCredential(): AuthCredential | null {
  try {
    const stored = window.sessionStorage.getItem(storageKey);
    if (stored === null) return null;
    const value: unknown = JSON.parse(stored);
    if (
      typeof value === "object" &&
      value !== null &&
      "workspaceId" in value &&
      typeof value.workspaceId === "string"
    ) {
      return {
        homeWorkspaceId:
          "homeWorkspaceId" in value &&
          typeof value.homeWorkspaceId === "string"
            ? value.homeWorkspaceId
            : value.workspaceId,
        workspaceId: value.workspaceId,
      };
    }
  } catch {
    // Browser storage is optional; the active session can remain in memory.
  }
  persistCredential(null);
  return null;
}

/**
 * The workspace of the cookie session, when the browser holds one: the
 * proxy presents the cookie to the API and the personal workspace comes
 * back. Nothing is thrown; without a session the tab starts signed out.
 */
async function discoverCookieSession(
  signal: AbortSignal,
): Promise<AuthCredential | null> {
  try {
    if (!sessionPresent(document.cookie)) return null;
    const response = await fetch("/api/auth/session", {
      cache: "no-store",
      signal,
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const workspaceId =
      typeof body === "object" &&
      body !== null &&
      "workspace" in body &&
      typeof body.workspace === "object" &&
      body.workspace !== null &&
      "id" in body.workspace &&
      typeof body.workspace.id === "string"
        ? body.workspace.id
        : null;
    return workspaceId === null
      ? null
      : { homeWorkspaceId: workspaceId, workspaceId };
  } catch {
    return null;
  }
}

/** Ends the cookie session on the server; the proxy clears the cookie either way. */
async function endCookieSession(): Promise<void> {
  try {
    await fetch("/api/auth/session", { method: "DELETE", cache: "no-store" });
  } catch {
    // The local session ends regardless; the server session expires on its own.
  }
}

function persistCredential(credential: AuthCredential | null): void {
  try {
    if (credential === null) window.sessionStorage.removeItem(storageKey);
    else window.sessionStorage.setItem(storageKey, JSON.stringify(credential));
  } catch {
    // Storage denial must not prevent an in-memory session transition.
  }
}

export function AuthSessionProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [session, setSession] = useState(() => ({
    credential: null as AuthCredential | null,
    controller: new AbortController(),
    generation: 0,
    isHydrated: false,
  }));
  const sessionRef = useRef(session);

  const replaceSession = useCallback((credential: AuthCredential | null) => {
    sessionRef.current.controller.abort();
    const next = {
      credential,
      controller: new AbortController(),
      generation: sessionRef.current.generation + 1,
      isHydrated: true,
    };
    sessionRef.current = next;
    setSession(next);
  }, []);

  useEffect(() => {
    const stored = readCredential();
    if (stored !== null) {
      replaceSession(stored);
      return () => sessionRef.current.controller.abort();
    }
    const discovery = new AbortController();
    void discoverCookieSession(discovery.signal).then((discovered) => {
      if (discovery.signal.aborted) return;
      if (discovered !== null) persistCredential(discovered);
      replaceSession(discovered);
    });
    return () => {
      discovery.abort();
      sessionRef.current.controller.abort();
    };
  }, [replaceSession]);

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      credential: session.credential,
      isHydrated: session.isHydrated,
      generation: session.generation,
      signal: session.controller.signal,
      signOut: () => {
        if (session.controller.signal.aborted) return;
        replaceSession(null);
        persistCredential(null);
        void endCookieSession();
      },
      startSession: (nextCredential) => {
        if (session.controller.signal.aborted) return;
        const storedCredential = {
          homeWorkspaceId: nextCredential.workspaceId,
          workspaceId: nextCredential.workspaceId,
        };
        replaceSession(storedCredential);
        persistCredential(storedCredential);
      },
      switchWorkspace: (workspaceId) => {
        if (
          session.controller.signal.aborted ||
          session.credential === null ||
          session.credential.workspaceId === workspaceId
        )
          return;
        const nextCredential = { ...session.credential, workspaceId };
        replaceSession(nextCredential);
        persistCredential(nextCredential);
      },
    }),
    [session, replaceSession],
  );

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession(): AuthSessionContextValue {
  const value = useContext(AuthSessionContext);
  if (value === null) {
    throw new Error("useAuthSession must be used within AuthSessionProvider.");
  }
  return value;
}
