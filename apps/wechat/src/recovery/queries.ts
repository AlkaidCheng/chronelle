import type { TrashItem } from "@chronelle/schemas";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useReadyAppRuntime } from "../runtime/app-runtime";
import { recoveryPreviewQueryKey, trashQueryKey } from "./data";

export function useTrash(
  workspaceId: string,
  objectType: TrashItem["objectType"] | null,
) {
  const { api } = useReadyAppRuntime();
  return useInfiniteQuery({
    queryKey: trashQueryKey(workspaceId, objectType),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.listTrash({
        limit: 20,
        ...(objectType === null ? {} : { objectType }),
        ...(pageParam === null ? {} : { cursor: pageParam }),
      }),
    getNextPageParam: (page) => page.nextCursor,
    retry: 1,
  });
}

export function useRecoveryPreview(workspaceId: string, objectId: string) {
  const { api } = useReadyAppRuntime();
  return useQuery({
    queryKey: recoveryPreviewQueryKey(workspaceId, objectId),
    queryFn: () => api.previewObjectRecovery(objectId),
    retry: 1,
    staleTime: 0,
  });
}

export function useRecoverObject() {
  const { api } = useReadyAppRuntime();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      expectedVersion,
    }: {
      id: string;
      expectedVersion: number;
    }) => api.recoverObject(id, { expectedVersion }),
    onSuccess: () => {
      void queryClient.invalidateQueries().catch(() => undefined);
    },
  });
}
