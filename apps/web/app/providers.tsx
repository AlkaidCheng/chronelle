"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";

import { ApiClientProvider } from "../lib/api-context";
import { AuthSessionProvider, useAuthSession } from "../lib/auth-session";
import { HistoryProvider } from "../features/history/history-provider";
import { LifecycleProvider } from "../features/recovery/lifecycle-provider";

export function Providers({ children }: { readonly children: ReactNode }) {
  return (
    <AuthSessionProvider>
      <SessionBoundary>{children}</SessionBoundary>
    </AuthSessionProvider>
  );
}

function SessionBoundary({ children }: { readonly children: ReactNode }) {
  const { generation } = useAuthSession();
  return <SessionProviders key={generation}>{children}</SessionProviders>;
}

function SessionProviders({ children }: { readonly children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 15_000,
          },
        },
      }),
  );

  useEffect(() => () => queryClient.clear(), [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider>
        <HistoryProvider>
          <LifecycleProvider>{children}</LifecycleProvider>
        </HistoryProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}
