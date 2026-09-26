import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";
import { sandboxWorkspaceId } from "./store";

function useSandboxSession() {
  const [role, setRole] = useState<"owner" | "viewer">("owner");
  const [generation, setGeneration] = useState(0);
  const [controller, setController] = useState(() => new AbortController());
  const credential = useMemo(
    () => ({
      accessToken: `sandbox-${role}`,
      workspaceId: sandboxWorkspaceId,
      homeWorkspaceId: sandboxWorkspaceId,
    }),
    [role],
  );
  function restart(nextRole = role) {
    controller.abort();
    setController(new AbortController());
    setRole(nextRole);
    setGeneration((value) => value + 1);
  }
  return {
    credential,
    generation,
    signal: controller.signal,
    isHydrated: true,
    role,
    setRole: restart,
    signOut: () => restart(),
    switchWorkspace: () => undefined,
    takeCarriedNotices: () => [],
    startSession: () => restart(),
  };
}

const Context = createContext<ReturnType<typeof useSandboxSession> | null>(
  null,
);
export function AuthSessionProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const session = useSandboxSession();
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
/** The sandbox has one workspace, so no switch carries a notice. */
export function useCarriedNotices() {
  return () => [];
}
export function useAuthSession() {
  const session = useContext(Context);
  if (session === null) throw new Error("Sandbox session provider required.");
  return session;
}
