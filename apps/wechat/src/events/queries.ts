import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

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
