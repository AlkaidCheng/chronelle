import type {
  EventContextCreatePayload,
  ExpenseResponse,
  ExpenseUpdatePayload,
} from "@chronelle/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { planningProjectionQueryKey } from "../features/planning/data";
import type { PlanningProjection } from "../features/planning/data";
import { useReadyAppRuntime } from "../runtime/app-runtime";
import { replaceExpenseProjection } from "./data";

export function useExpenseAccess(workspaceId: string, resourceId: string) {
  const { api } = useReadyAppRuntime();
  return useQuery({
    queryKey: ["wechat-expense-access", workspaceId, resourceId],
    queryFn: () => api.getObjectAccess(resourceId),
    retry: 1,
  });
}

function useExpenseInvalidation(workspaceId: string, eventId: string) {
  const queryClient = useQueryClient();
  return (saved?: ExpenseResponse) => {
    if (saved !== undefined) {
      const key = planningProjectionQueryKey(workspaceId, eventId, "expenses");
      queryClient.setQueryData<PlanningProjection>(key, (current) =>
        replaceExpenseProjection(current, saved),
      );
    }
    return queryClient.invalidateQueries({
      queryKey: planningProjectionQueryKey(workspaceId, eventId),
    });
  };
}

export function useCreateEventExpense(workspaceId: string, eventId: string) {
  const { api } = useReadyAppRuntime();
  const invalidate = useExpenseInvalidation(workspaceId, eventId);
  return useMutation({
    mutationFn: async (input: EventContextCreatePayload) => {
      const result = await api.createEventResource(eventId, input);
      if (result.resource.objectType !== "expense")
        throw new Error("The Event resource is not an Expense.");
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

export function useUpdateEventExpense(workspaceId: string, eventId: string) {
  const { api } = useReadyAppRuntime();
  const invalidate = useExpenseInvalidation(workspaceId, eventId);
  return useMutation({
    mutationFn: (input: {
      readonly id: string;
      readonly payload: ExpenseUpdatePayload;
    }) => api.updateExpense(input.id, input.payload),
    onSuccess: (saved) => {
      void invalidate(saved).catch(() => undefined);
    },
    onError: () => {
      void invalidate().catch(() => undefined);
    },
  });
}
