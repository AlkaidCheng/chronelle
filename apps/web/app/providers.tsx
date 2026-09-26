"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { NoticesProvider } from "../components/notices";
import { HistoryProvider } from "../features/history/history-provider";
import { LifecycleProvider } from "../features/recovery/lifecycle-provider";
import { ApiClientProvider } from "../lib/api-context";
import { AuthSessionProvider, useAuthSession } from "../lib/auth-session";
import { CommandHistoryProvider } from "../lib/command-history";
import { EditorDraftProvider } from "../lib/editor-draft-context";
import { EventCollectionProvider } from "../lib/event-collection-state";
import { watchTips } from "../lib/tooltips";

export function Providers({ children }: { readonly children: ReactNode }) {
  useEffect(() => watchTips(document), []);
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
          <NoticesProvider>
            <LifecycleProvider>
              <EditorDraftProvider>
                <CommandHistoryProvider>
                  <EventCollectionProvider>{children}</EventCollectionProvider>
                </CommandHistoryProvider>
              </EditorDraftProvider>
            </LifecycleProvider>
          </NoticesProvider>
        </HistoryProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}
