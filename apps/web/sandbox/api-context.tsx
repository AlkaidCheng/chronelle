import { ChronelleApiClient } from "@chronelle/api-client";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useAuthSession } from "./auth-session";
import { SandboxStore } from "./store";

export const store = new SandboxStore();
const Context = createContext<ChronelleApiClient | null>(null);
export function ApiClientProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { credential, signal, role } = useAuthSession();
  const client = useMemo(
    () =>
      new ChronelleApiClient({
        getCredential: () => credential,
        signal,
        fetch: (input, options) => store.fetch(input, options, role),
      }),
    [credential, signal, role],
  );
  return <Context.Provider value={client}>{children}</Context.Provider>;
}
export function useApiClient() {
  const client = useContext(Context);
  if (client === null) throw new Error("Sandbox API provider required.");
  return client;
}
