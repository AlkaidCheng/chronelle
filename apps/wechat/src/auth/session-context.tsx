import { ApiClientError } from "@chronelle/api-client";
import type {
  PreferencesRequest,
  SessionResponse,
  UserResponse,
} from "@chronelle/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useAppRuntime, type AppRuntime } from "../runtime/app-runtime";
import { useOnline } from "../runtime/online";
import { passwordSignInNotice, type SignInNotice } from "./sign-in-notice";

type SessionState =
  | { readonly status: "configuration-error"; readonly reason: string }
  | { readonly status: "restoring" }
  | { readonly status: "signed-out"; readonly linkingRequired: boolean }
  | { readonly status: "loading" }
  | { readonly status: "offline" }
  | { readonly status: "error" }
  | { readonly status: "onboarding"; readonly session: SessionResponse }
  | { readonly status: "ready"; readonly session: SessionResponse };

interface SessionContextValue {
  readonly state: SessionState;
  readonly busy: boolean;
  readonly notice: SignInNotice | null;
  completeOnboarding(displayName: string): Promise<void>;
  resetSignInFlow(): void;
  linkExistingAccount(login: string, password: string): Promise<void>;
  refresh(): Promise<void>;
  signInWithPassword(login: string, password: string): Promise<void>;
  signInWithWeChat(): Promise<void>;
  signOut(): Promise<void>;
  switchWorkspace(workspaceId: string): Promise<void>;
  updatePreferences(input: PreferencesRequest): Promise<UserResponse>;
}

const unavailable = async () => undefined;
const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const runtime = useAppRuntime();
  if (runtime.status === "configuration-error") {
    return (
      <SessionContext.Provider
        value={{
          state: {
            status: "configuration-error",
            reason: runtime.reason,
          },
          busy: false,
          notice: null,
          completeOnboarding: unavailable,
          resetSignInFlow: () => undefined,
          linkExistingAccount: unavailable,
          refresh: unavailable,
          signInWithPassword: unavailable,
          signInWithWeChat: unavailable,
          signOut: unavailable,
          switchWorkspace: unavailable,
          updatePreferences: async () => {
            throw new Error("The Mini Program runtime is not configured.");
          },
        }}
      >
        {children}
      </SessionContext.Provider>
    );
  }
  return (
    <ReadySessionProvider runtime={runtime.runtime}>
      {children}
    </ReadySessionProvider>
  );
}

interface CredentialState {
  readonly revision: number;
  readonly workspaceId: string;
}

function ReadySessionProvider({
  children,
  runtime,
}: PropsWithChildren<{ readonly runtime: AppRuntime }>) {
  const online = useOnline();
  const queryClient = useQueryClient();
  const [credential, setCredential] = useState<CredentialState | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [linkingRequired, setLinkingRequired] = useState(false);
  const [notice, setNotice] = useState<SignInNotice | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void runtime.sessions
      .restore()
      .then((restored) => {
        if (!active) return;
        if (restored !== null) {
          setCredential({ revision: 0, workspaceId: restored.workspaceId });
        }
      })
      .catch(() => {
        if (active) setNotice("storageFailed");
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [runtime]);

  const sessionQuery = useQuery({
    enabled: credential !== null,
    queryKey: [
      "wechat-session",
      credential?.workspaceId ?? "none",
      credential?.revision ?? 0,
    ],
    queryFn: () => runtime.api.getSession(),
    retry: (failures, error) =>
      !(error instanceof ApiClientError && error.status < 500) && failures < 2,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (
      credential === null ||
      !(sessionQuery.error instanceof ApiClientError) ||
      sessionQuery.error.status !== 401
    ) {
      return;
    }
    let active = true;
    void runtime.sessions.clear().finally(() => {
      if (!active) return;
      setCredential(null);
      setLinkingRequired(false);
      setNotice("sessionExpired");
      queryClient.clear();
    });
    return () => {
      active = false;
    };
  }, [credential, queryClient, runtime, sessionQuery.error]);

  const activate = useCallback(
    (workspaceId: string) => {
      queryClient.clear();
      setCredential((current) => ({
        revision: (current?.revision ?? 0) + 1,
        workspaceId,
      }));
      setLinkingRequired(false);
      setNotice(null);
    },
    [queryClient],
  );

  const resetSignInFlow = useCallback(() => {
    setLinkingRequired(false);
    setNotice(null);
  }, []);

  const signInWithWeChat = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    let authenticated = false;
    try {
      const accessToken = await runtime.identity.getAccessToken();
      const session = await runtime.api.signInWithWeChat({ accessToken });
      authenticated = true;
      await runtime.sessions.save(session);
      activate(session.workspace.id);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        setLinkingRequired(true);
      } else {
        setNotice(authenticated ? "storageFailed" : "signInFailed");
      }
    } finally {
      setBusy(false);
    }
  }, [activate, runtime]);

  const signInWithPassword = useCallback(
    async (login: string, password: string) => {
      setBusy(true);
      setNotice(null);
      let authenticated = false;
      try {
        const session = await runtime.api.signInWithPassword({
          login,
          password,
        });
        authenticated = true;
        await runtime.sessions.save(session);
        activate(session.workspace.id);
      } catch (error) {
        setNotice(
          authenticated ? "storageFailed" : passwordSignInNotice(error),
        );
      } finally {
        setBusy(false);
      }
    },
    [activate, runtime],
  );

  const linkExistingAccount = useCallback(
    async (login: string, password: string) => {
      setBusy(true);
      setNotice(null);
      let passwordAuthenticated = false;
      let passwordSessionStored = false;
      try {
        const session = await runtime.api.signInWithPassword({
          login,
          password,
        });
        passwordAuthenticated = true;
        await runtime.sessions.save(session);
        passwordSessionStored = true;
        const accessToken = await runtime.identity.getAccessToken();
        await runtime.api.linkWeChatIdentity({ accessToken });
        activate(session.workspace.id);
      } catch (error) {
        if (passwordSessionStored) {
          await runtime.api.signOut().catch(() => undefined);
          await runtime.sessions.clear().catch(() => undefined);
        }
        setCredential(null);
        setNotice(
          passwordSessionStored
            ? "linkFailed"
            : passwordAuthenticated
              ? "storageFailed"
              : passwordSignInNotice(error),
        );
      } finally {
        setBusy(false);
      }
    },
    [activate, runtime],
  );

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await runtime.sessions.signOut(runtime.api);
    } catch {
      setNotice("storageFailed");
    } finally {
      queryClient.clear();
      setCredential(null);
      setLinkingRequired(false);
      setBusy(false);
    }
  }, [queryClient, runtime]);

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      if (credential?.workspaceId === workspaceId) return;
      setBusy(true);
      try {
        await queryClient.cancelQueries();
        const next = await runtime.sessions.selectWorkspace(workspaceId);
        activate(next.workspaceId);
      } catch {
        setNotice("storageFailed");
      } finally {
        setBusy(false);
      }
    },
    [activate, credential?.workspaceId, queryClient, runtime],
  );

  const completeOnboarding = useCallback(
    async (displayName: string) => {
      setBusy(true);
      setNotice(null);
      try {
        await runtime.api.updateAccount({
          displayName: displayName.trim(),
          onboarded: true,
        });
        await sessionQuery.refetch();
      } catch {
        setNotice("signInFailed");
      } finally {
        setBusy(false);
      }
    },
    [runtime, sessionQuery],
  );

  const refresh = useCallback(async () => {
    await sessionQuery.refetch();
  }, [sessionQuery]);

  const updatePreferences = useCallback(
    async (input: PreferencesRequest): Promise<UserResponse> => {
      if (credential === null) throw new Error("A session is required.");
      try {
        const user = await runtime.api.updatePreferences(input);
        queryClient.setQueryData<SessionResponse>(
          ["wechat-session", credential.workspaceId, credential.revision],
          (current) => (current ? { ...current, user } : current),
        );
        return user;
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) {
          await sessionQuery.refetch();
        }
        throw error;
      }
    },
    [credential, queryClient, runtime, sessionQuery],
  );

  let state: SessionState;
  if (restoring) state = { status: "restoring" };
  else if (credential === null) {
    state = { status: "signed-out", linkingRequired };
  } else if (sessionQuery.data !== undefined) {
    state = sessionQuery.data.user.onboardedAt
      ? { status: "ready", session: sessionQuery.data }
      : { status: "onboarding", session: sessionQuery.data };
  } else if (!online) state = { status: "offline" };
  else if (sessionQuery.isError) state = { status: "error" };
  else state = { status: "loading" };

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      busy,
      notice,
      completeOnboarding,
      resetSignInFlow,
      linkExistingAccount,
      refresh,
      signInWithPassword,
      signInWithWeChat,
      signOut,
      switchWorkspace,
      updatePreferences,
    }),
    [
      busy,
      completeOnboarding,
      resetSignInFlow,
      linkExistingAccount,
      notice,
      refresh,
      signInWithPassword,
      signInWithWeChat,
      signOut,
      state,
      switchWorkspace,
      updatePreferences,
    ],
  );
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const session = useContext(SessionContext);
  if (session === null) throw new Error("SessionProvider is missing.");
  return session;
}
