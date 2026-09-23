import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { eventListQueryKey, eventOverviewQueryKey } from "./queries";
import { useReadyAppRuntime } from "../runtime/app-runtime";

export function eventHistoryQueryKey(workspaceId: string, eventId: string) {
  return ["wechat-event-history", workspaceId, eventId] as const;
}

export function useEventHistory(workspaceId: string, eventId: string) {
  const { api } = useReadyAppRuntime();
  return useInfiniteQuery({
    enabled: eventId.length > 0,
    queryKey: eventHistoryQueryKey(workspaceId, eventId),
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      api.listObjectRevisions(eventId, {
        limit: 20,
        ...(pageParam === null ? {} : { beforeVersion: pageParam }),
      }),
    getNextPageParam: (lastPage) => lastPage.nextBeforeVersion,
    retry: 1,
  });
}

export function useEventRevision(
  workspaceId: string,
  eventId: string,
  version: number | null,
) {
  const { api } = useReadyAppRuntime();
  return useQuery({
    enabled: eventId.length > 0 && version !== null,
    queryKey: ["wechat-event-revision", workspaceId, eventId, version],
    queryFn: () => api.getObjectRevision(eventId, version ?? 0),
    retry: 1,
  });
}

export function useEventRestorePreview(
  workspaceId: string,
  eventId: string,
  version: number | null,
) {
  const { api } = useReadyAppRuntime();
  return useQuery({
    enabled: eventId.length > 0 && version !== null,
    queryKey: ["wechat-event-restore-preview", workspaceId, eventId, version],
    queryFn: () => api.previewObjectRestoration(eventId, version ?? 0),
    staleTime: 0,
    retry: 1,
  });
}

export function useRestoreEventRevision(workspaceId: string, eventId: string) {
  const { api } = useReadyAppRuntime();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      readonly version: number;
      readonly expectedVersion: number;
    }) =>
      api.restoreObjectRevision(eventId, input.version, {
        expectedVersion: input.expectedVersion,
      }),
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: eventHistoryQueryKey(workspaceId, eventId),
        }),
        queryClient.invalidateQueries({
          queryKey: eventOverviewQueryKey(workspaceId, eventId),
        }),
        queryClient.invalidateQueries({
          queryKey: eventListQueryKey(workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: ["wechat-event-restore-preview", workspaceId, eventId],
        }),
      ]).catch(() => undefined);
    },
  });
}
