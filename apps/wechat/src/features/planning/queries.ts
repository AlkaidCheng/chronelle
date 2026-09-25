import type { EventLayoutResponse } from "@livtales/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useReadyAppRuntime } from "../../runtime/app-runtime";
import type { PlanningComponentKind } from "./catalog";
import {
  loadPlanningProjection,
  planningLayoutQueryKey,
  planningProjectionQueryKey,
} from "./data";

export { planningLayoutQueryKey, planningProjectionQueryKey } from "./data";

export function usePlanningLayout(workspaceId: string, eventId: string) {
  const { api } = useReadyAppRuntime();
  return useQuery({
    queryKey: planningLayoutQueryKey(workspaceId, eventId),
    queryFn: () => api.getEventLayout(eventId),
    retry: 1,
  });
}

export function useUpdatePlanningLayout(workspaceId: string, eventId: string) {
  const { api } = useReadyAppRuntime();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["wechat-event-layout-update", workspaceId, eventId],
    mutationFn: (input: {
      readonly expectedVersion: number;
      readonly pages: EventLayoutResponse["pages"];
    }) => api.updateEventLayout(eventId, input),
    onSuccess: (layout) => {
      queryClient.setQueryData(
        planningLayoutQueryKey(workspaceId, eventId),
        layout,
      );
    },
  });
}

export function usePlanningProjection(
  workspaceId: string,
  eventId: string,
  kind: PlanningComponentKind,
) {
  const { api } = useReadyAppRuntime();
  return useQuery({
    queryKey: planningProjectionQueryKey(workspaceId, eventId, kind),
    queryFn: () => loadPlanningProjection(api, eventId, kind),
    retry: 1,
  });
}
