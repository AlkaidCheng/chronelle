import type {
  ObjectAccessResponse,
  PersonCreatePayload,
  PersonResponse,
  PersonUpdatePayload,
} from "@livtales/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useReadyAppRuntime } from "../runtime/app-runtime";
import { friendsKey, peopleListKey, personDetailKey } from "./data";

export function usePeopleList(workspaceId: string, query: string) {
  const { api } = useReadyAppRuntime();
  return useQuery({
    queryKey: peopleListKey(workspaceId, query),
    queryFn: () => api.listPersons({ query, limit: 100 }),
    retry: 1,
  });
}

export function usePersonDetail(workspaceId: string, personId: string | null) {
  const { api } = useReadyAppRuntime();
  return useQuery({
    enabled: personId !== null,
    queryKey: personDetailKey(workspaceId, personId ?? "missing"),
    queryFn: async () => {
      if (personId === null) throw new Error("The Person id is missing.");
      const [person, access] = await Promise.all([
        api.getPerson(personId),
        api.getObjectAccess(personId),
      ]);
      return { person, access };
    },
    retry: 1,
  });
}

export function useCreatePerson(workspaceId: string) {
  const { api } = useReadyAppRuntime();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (input: PersonCreatePayload) => api.createPerson(input),
    onSuccess: () => {
      void queries
        .invalidateQueries({ queryKey: peopleListKey(workspaceId) })
        .catch(() => undefined);
    },
  });
}

export function useUpdatePerson(workspaceId: string, personId: string) {
  const { api } = useReadyAppRuntime();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (input: PersonUpdatePayload) =>
      api.updatePerson(personId, input),
    onSuccess: (person: PersonResponse) => {
      queries.setQueryData<{
        person: PersonResponse;
        access: ObjectAccessResponse;
      }>(personDetailKey(workspaceId, personId), (current) =>
        current === undefined ? current : { ...current, person },
      );
      void queries
        .invalidateQueries({ queryKey: peopleListKey(workspaceId) })
        .catch(() => undefined);
    },
  });
}

export function useFriends(userId: string) {
  const { api } = useReadyAppRuntime();
  return useQuery({
    queryKey: friendsKey(userId),
    queryFn: () => api.listFriends(),
    retry: 1,
  });
}
