"use client";

import { objectSearchQuerySchema } from "@livtales/schemas";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useApiClient } from "./api-context";
import { useAuthSession } from "./auth-session";

const resultLimit = 8;

export function useCommandSearch(query: string, isComposing: boolean) {
  const client = useApiClient();
  const { credential, generation, signal } = useAuthSession();
  const parsed = objectSearchQuerySchema.shape.query.safeParse(query);
  const term = !isComposing && parsed.success ? parsed.data : null;
  const [settledTerm, setSettledTerm] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledTerm(term), 250);
    return () => window.clearTimeout(timer);
  }, [term]);
  const activeTerm = term === settledTerm ? term : null;
  const search = useQuery({
    queryKey: [
      "search",
      "commands",
      generation,
      credential?.homeWorkspaceId,
      credential?.workspaceId,
      activeTerm,
    ],
    enabled: credential !== null && !signal.aborted && activeTerm !== null,
    queryFn: ({ signal: requestSignal }) => {
      if (activeTerm === null) throw new Error("Search input is required.");
      return client.withSignal(requestSignal).searchObjects({
        query: activeTerm,
        limit: resultLimit,
      });
    },
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const ready =
    activeTerm !== null &&
    !signal.aborted &&
    search.isSuccess &&
    !search.isFetching;
  return {
    items: ready ? search.data.items.slice(0, resultLimit) : [],
    hasMore: ready && search.data.nextCursor !== null,
    isSearching: term !== null && (activeTerm === null || search.isFetching),
    isError: activeTerm !== null && search.isError,
    isEmpty: ready && search.data.items.length === 0,
    retry: () => void search.refetch(),
  };
}
