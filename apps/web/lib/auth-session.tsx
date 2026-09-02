"use client";

import type { ApiCredential } from "@chronelle/api-client";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const storageKey = "chronelle.development-session";

interface AuthCredential extends ApiCredential {
  readonly homeWorkspaceId: string;
}

interface AuthSessionContextValue {
  readonly credential: AuthCredential | null;
  readonly isHydrated: boolean;
  readonly signOut: () => void;
  readonly startSession: (credential: ApiCredential) => void;
  readonly switchWorkspace: (workspaceId: string) => void;
}

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

function readCredential(): AuthCredential | null {
  const stored = window.sessionStorage.getItem(storageKey);
  if (stored === null) {
    return null;
  }

  try {
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
    window.sessionStorage.removeItem(storageKey);
  } catch {
    window.sessionStorage.removeItem(storageKey);
  }
  return null;
}

export function AuthSessionProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [credential, setCredential] = useState<AuthCredential | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setCredential(readCredential());
    setIsHydrated(true);
  }, []);

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      credential,
      isHydrated,
      signOut: () => {
        window.sessionStorage.removeItem(storageKey);
        setCredential(null);
      },
      startSession: (nextCredential) => {
        const storedCredential = {
          ...nextCredential,
          homeWorkspaceId: nextCredential.workspaceId,
        };
        window.sessionStorage.setItem(
          storageKey,
          JSON.stringify(storedCredential),
        );
        setCredential(storedCredential);
      },
      switchWorkspace: (workspaceId) => {
        setCredential((current) => {
          if (current === null) {
            return null;
          }
          const nextCredential = { ...current, workspaceId };
          window.sessionStorage.setItem(
            storageKey,
            JSON.stringify(nextCredential),
          );
          return nextCredential;
        });
      },
    }),
    [credential, isHydrated],
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
