"use client";

import type { EventLayoutUpdate } from "@chronelle/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "./api-context";
import { useAuthSession } from "./auth-session";
import { queryKeys } from "./queries";

const layoutKey = (eventId: string) =>
  [...queryKeys.event(eventId), "layout"] as const;

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
    onSuccess: async (layout) => {
      await cache.cancelQueries({ queryKey: layoutKey(eventId) });
      cache.setQueryData(layoutKey(eventId), layout);
    },
  });
}
