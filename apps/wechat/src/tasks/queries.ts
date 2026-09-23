import type {
  EventContextCreatePayload,
  ObjectAccessResponse,
  TaskResponse,
  TaskUpdatePayload,
} from "@chronelle/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PlanningProjection } from "../features/planning/data";
import { planningProjectionQueryKey } from "../features/planning/data";
import { useReadyAppRuntime } from "../runtime/app-runtime";
import { replaceTaskProjection, taskAccessQueryKey } from "./data";

export function useTaskAccess(workspaceId: string, resourceId: string) {
  const { api } = useReadyAppRuntime();
  return useQuery({
    queryKey: taskAccessQueryKey(workspaceId, resourceId),
    queryFn: () => api.getObjectAccess(resourceId),
    retry: 1,
  });
}

function useTaskProjectionInvalidation(workspaceId: string, eventId: string) {
  const queryClient = useQueryClient();
  return (saved?: TaskResponse) => {
    if (saved !== undefined) {
      const queryKey = planningProjectionQueryKey(
        workspaceId,
        eventId,
        "todos",
      );
      queryClient.setQueryData<PlanningProjection>(queryKey, (current) =>
        replaceTaskProjection(current, saved),
      );
    }
    return queryClient.invalidateQueries({
      queryKey: planningProjectionQueryKey(workspaceId, eventId),
    });
  };
}

export function useCreateEventTask(workspaceId: string, eventId: string) {
  const { api } = useReadyAppRuntime();
  const invalidate = useTaskProjectionInvalidation(workspaceId, eventId);
  return useMutation({
    mutationFn: async (input: EventContextCreatePayload) => {
      const result = await api.createEventResource(eventId, input);
      if (result.resource.objectType !== "task")
        throw new Error("The Event resource is not a Task.");
      return result.resource;
    },
    onSuccess: (saved) => {
      void invalidate(saved).catch(() => undefined);
    },
    onError: () => {
      void invalidate().catch(() => undefined);
    },
  });
}

export function useUpdateEventTask(workspaceId: string, eventId: string) {
  const { api } = useReadyAppRuntime();
  const invalidate = useTaskProjectionInvalidation(workspaceId, eventId);
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      readonly id: string;
      readonly input: TaskUpdatePayload;
    }) => api.updateTask(id, input),
    onSuccess: (saved) => {
      void invalidate(saved).catch(() => undefined);
    },
    onError: () => {
      void invalidate().catch(() => undefined);
    },
  });
}

export function canEditTask(access: ObjectAccessResponse | undefined) {
  return access?.actions.includes("edit") === true;
}
