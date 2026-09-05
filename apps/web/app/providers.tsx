"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { ApiClientProvider } from "../lib/api-context";
import { AuthSessionProvider } from "../lib/auth-session";
import { HistoryProvider } from "../features/history/history-provider";
import { LifecycleProvider } from "../features/recovery/lifecycle-provider";

export function Providers({ children }: { readonly children: ReactNode }) {
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

  return (
    <QueryClientProvider client={queryClient}>
      <AuthSessionProvider>
        <ApiClientProvider>
          <HistoryProvider>
            <LifecycleProvider>{children}</LifecycleProvider>
          </HistoryProvider>
        </ApiClientProvider>
      </AuthSessionProvider>
    </QueryClientProvider>
  );
}
