import type {
  SectionCreateRequest,
  SectionUpdateRequest,
} from "@chronelle/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { planningProjectionQueryKey } from "../features/planning/data";
import { useReadyAppRuntime } from "../runtime/app-runtime";

type SectionChange =
  | { readonly kind: "create"; readonly input: SectionCreateRequest }
  | {
      readonly kind: "update";
      readonly id: string;
      readonly input: SectionUpdateRequest;
    }
  | { readonly kind: "delete"; readonly id: string };

export function useTaskSectionMutation(workspaceId: string, eventId: string) {
  const { api } = useReadyAppRuntime();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: SectionChange) => {
      switch (change.kind) {
        case "create":
          return api.createSection(eventId, change.input);
        case "update":
          return api.updateSection(change.id, change.input);
        case "delete":
          return api.deleteSection(change.id);
      }
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: planningProjectionQueryKey(workspaceId, eventId),
      }),
  });
}
