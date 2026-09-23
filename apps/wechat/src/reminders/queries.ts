import type {
  EventContextCreatePayload,
  ReminderResponse,
  ReminderUpdatePayload,
} from "@chronelle/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PlanningProjection } from "../features/planning/data";
import { planningProjectionQueryKey } from "../features/planning/data";
import { useReadyAppRuntime } from "../runtime/app-runtime";
import { replaceReminderProjection } from "./data";

export function useReminderAccess(workspaceId: string, resourceId: string) {
  const { api } = useReadyAppRuntime();
  return useQuery({
    queryKey: ["wechat-reminder-access", workspaceId, resourceId],
    queryFn: () => api.getObjectAccess(resourceId),
    retry: 1,
  });
}

function useReminderInvalidation(workspaceId: string, eventId: string) {
  const queryClient = useQueryClient();
  return (saved?: ReminderResponse) => {
    if (saved !== undefined) {
      const key = planningProjectionQueryKey(workspaceId, eventId, "reminders");
      queryClient.setQueryData<PlanningProjection>(key, (current) =>
        replaceReminderProjection(current, saved),
      );
    }
    return queryClient.invalidateQueries({
      queryKey: planningProjectionQueryKey(workspaceId, eventId),
    });
  };
}

export function useCreateEventReminder(workspaceId: string, eventId: string) {
  const { api } = useReadyAppRuntime();
  const invalidate = useReminderInvalidation(workspaceId, eventId);
  return useMutation({
    mutationFn: async (input: EventContextCreatePayload) => {
      const result = await api.createEventResource(eventId, input);
      if (result.resource.objectType !== "reminder")
        throw new Error("The Event resource is not a Reminder.");
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

export function useUpdateEventReminder(workspaceId: string, eventId: string) {
  const { api } = useReadyAppRuntime();
  const invalidate = useReminderInvalidation(workspaceId, eventId);
  return useMutation({
    mutationFn: (input: {
      readonly id: string;
      readonly payload: ReminderUpdatePayload;
    }) => api.updateReminder(input.id, input.payload),
    onSuccess: (saved) => {
      void invalidate(saved).catch(() => undefined);
    },
    onError: () => {
      void invalidate().catch(() => undefined);
    },
  });
}
