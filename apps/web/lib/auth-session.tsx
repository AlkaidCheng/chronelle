"use client";

import type { ApiCredential } from "@chronelle/api-client";
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

const storageKey = "chronelle.development-session";

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
      "accessToken" in value &&
      typeof value.accessToken === "string" &&
      "workspaceId" in value &&
      typeof value.workspaceId === "string"
    ) {
      return {
        accessToken: value.accessToken,
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
    replaceSession(readCredential());
    return () => sessionRef.current.controller.abort();
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
      },
      startSession: (nextCredential) => {
        if (session.controller.signal.aborted) return;
        const storedCredential = {
          ...nextCredential,
          homeWorkspaceId: nextCredential.workspaceId,
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
