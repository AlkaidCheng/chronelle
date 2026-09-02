"use client";

import { ChronelleApiClient } from "@chronelle/api-client";
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
} from "react";

import { useAuthSession } from "./auth-session";

const ApiClientContext = createContext<ChronelleApiClient | null>(null);

export function ApiClientProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { credential } = useAuthSession();
  const credentialRef = useRef(credential);
  credentialRef.current = credential;

  const client = useMemo(
    () =>
      new ChronelleApiClient({
        getCredential: () => credentialRef.current,
      }),
    [],
  );

  return (
    <ApiClientContext.Provider value={client}>
      {children}
    </ApiClientContext.Provider>
  );
}

export function useApiClient(): ChronelleApiClient {
  const client = useContext(ApiClientContext);
  if (client === null) {
    throw new Error("useApiClient must be used within ApiClientProvider.");
  }
  return client;
}
