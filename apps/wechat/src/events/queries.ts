import type {
  EventCreatePayload,
  EventResponse,
  EventUpdatePayload,
  ObjectAccessResponse,
} from "@chronelle/schemas";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useReadyAppRuntime } from "../runtime/app-runtime";

export function eventListQueryKey(workspaceId: string) {
  return ["wechat-events", workspaceId] as const;
}

export function useEventList(workspaceId: string) {
  const { api } = useReadyAppRuntime();
  return useInfiniteQuery({
    queryKey: eventListQueryKey(workspaceId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.listEvents({
        filter: "all",
        limit: 20,
        scope: "all",
        sort: "date",
        ...(pageParam === null ? {} : { cursor: pageParam }),
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function eventOverviewQueryKey(workspaceId: string, eventId: string) {
  return ["wechat-event-overview", workspaceId, eventId] as const;
}

export function useEventOverview(workspaceId: string, eventId: string | null) {
  const { api } = useReadyAppRuntime();
  return useQuery({
    enabled: eventId !== null,
    queryKey: eventOverviewQueryKey(workspaceId, eventId ?? "missing"),
    queryFn: async () => {
      if (eventId === null) throw new Error("The Event id is missing.");
      const [event, access] = await Promise.all([
        api.getEvent(eventId),
        api.getObjectAccess(eventId),
      ]);
      return { access, event };
    },
    retry: 1,
  });
}

export function useCreateEvent(workspaceId: string) {
  const { api } = useReadyAppRuntime();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EventCreatePayload) => api.createEvent(input),
    onSuccess: () => {
      void queryClient
        .invalidateQueries({ queryKey: eventListQueryKey(workspaceId) })
        .catch(() => undefined);
    },
  });
}

export function useUpdateEvent(workspaceId: string, eventId: string) {
  const { api } = useReadyAppRuntime();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EventUpdatePayload) => api.updateEvent(eventId, input),
    onSuccess: (event) => {
      queryClient.setQueryData<{
        readonly access: ObjectAccessResponse;
        readonly event: EventResponse;
      }>(eventOverviewQueryKey(workspaceId, eventId), (current) =>
        current === undefined ? current : { ...current, event },
      );
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: eventListQueryKey(workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: eventOverviewQueryKey(workspaceId, eventId),
        }),
      ]).catch(() => undefined);
    },
  });
}
