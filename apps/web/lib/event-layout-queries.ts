"use client";

import type {
  EventLayoutResponse,
  EventLayoutRestore,
  EventLayoutUpdate,
} from "@chronelle/schemas";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useApiClient } from "./api-context";
import { useAuthSession } from "./auth-session";
import { queryKeys } from "./queries";
import {
  advanceLayoutUndo,
  emptyLayoutUndo,
  type LayoutIntent,
  type LayoutUndoState,
} from "./layout-undo";

const layoutKey = (eventId: string) =>
  [...queryKeys.event(eventId), "layout"] as const;
const historyKey = (eventId: string) =>
  [...layoutKey(eventId), "history"] as const;
const undoKey = (eventId: string) => ["layout-undo", eventId] as const;

async function acceptLayout(
  cache: QueryClient,
  layout: EventLayoutResponse,
  previousVersion: number,
  intent: LayoutIntent,
) {
  await cache.cancelQueries({
    queryKey: layoutKey(layout.eventId),
    exact: true,
  });
  const current = cache.getQueryData<EventLayoutResponse>(
    layoutKey(layout.eventId),
  );
  if (current && current.version > layout.version) return;
  cache.setQueryData<LayoutUndoState>(undoKey(layout.eventId), (state) =>
    advanceLayoutUndo(
      state ?? emptyLayoutUndo,
      previousVersion,
      layout.version,
      intent,
    ),
  );
  cache.setQueryData(layoutKey(layout.eventId), layout);
  await cache.invalidateQueries({ queryKey: historyKey(layout.eventId) });
}

export function useLayoutUndo(eventId: string) {
  return useQuery({
    queryKey: undoKey(eventId),
    initialData: emptyLayoutUndo,
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useEventLayoutHistory(eventId: string) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useInfiniteQuery({
    enabled: credential !== null,
    queryKey: historyKey(eventId),
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      client
        .withSignal(signal)
        .getEventLayoutHistory(
          eventId,
          pageParam === undefined ? {} : { beforeVersion: pageParam },
        ),
    getNextPageParam: (page) => page.nextBeforeVersion ?? undefined,
  });
}

export function useRestoreEventLayout(eventId: string) {
  const client = useApiClient();
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({
      intent = "edit",
      ...input
    }: EventLayoutRestore & { intent?: LayoutIntent }) => {
      if (intent !== "edit") {
        const state = cache.getQueryData<LayoutUndoState>(undoKey(eventId));
        if (
          state?.version !== input.expectedVersion ||
          state[intent].at(-1) !== input.targetVersion
        )
          throw new Error(
            "The layout changed. Refresh before using undo or redo.",
          );
      }
      return client.restoreEventLayout(eventId, input);
    },
    onSuccess: (layout, input) =>
      acceptLayout(
        cache,
        layout,
        input.expectedVersion,
        input.intent ?? "edit",
      ),
  });
}

export function useEventLayout(eventId: string) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    queryKey: layoutKey(eventId),
    enabled: credential !== null,
    queryFn: ({ signal }) => client.withSignal(signal).getEventLayout(eventId),
  });
}

export function useUpdateEventLayout(eventId: string) {
  const client = useApiClient();
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (input: EventLayoutUpdate) =>
      client.updateEventLayout(eventId, input),
    onSuccess: (layout, input) =>
      acceptLayout(cache, layout, input.expectedVersion, "edit"),
  });
}
