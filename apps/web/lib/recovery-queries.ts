"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { RecoveryRequest, TrashQueryInput } from "@chronelle/schemas";
import { useApiClient } from "./api-context";
import { useAuthSession } from "./auth-session";
import { queryKeys, useCanonicalInvalidation } from "./queries";

function useRecoveryInvalidation() {
  const invalidate = useCanonicalInvalidation();
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      invalidate(),
      queryClient.invalidateQueries({ queryKey: queryKeys.session }),
    ]);
  };
}

export function useTrash(input: TrashQueryInput) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useInfiniteQuery({
    queryKey: ["trash", input],
    enabled: credential !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.withSignal(signal).listTrash({
        ...input,
        ...(pageParam === undefined ? {} : { beforeId: pageParam }),
      }),
    getNextPageParam: (page) => page.nextBeforeId ?? undefined,
  });
}

export function useRecoveryPreview(objectId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: ["object", objectId, "recovery-preview"],
    staleTime: 0,
    queryFn: ({ signal }) =>
      client.withSignal(signal).previewObjectRecovery(objectId),
  });
}

export function useRecoverObject(objectId: string) {
  const client = useApiClient();
  const invalidate = useRecoveryInvalidation();
  return useMutation({
    mutationFn: (input: RecoveryRequest) =>
      client.recoverObject(objectId, input),
    onSuccess: invalidate,
  });
}

export function useRemovedRelations(objectId: string) {
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: ["object", objectId, "removed-relations"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.withSignal(signal).listRemovedRelations(objectId, {
        limit: 20,
        ...(pageParam === undefined ? {} : { beforeId: pageParam }),
      }),
    getNextPageParam: (page) => page.nextBeforeId ?? undefined,
  });
}

export function useRecoverRelation() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      client.recoverRelation(id, { expectedVersion: version }),
    onSuccess: invalidate,
  });
}

export interface LifecycleTarget {
  readonly id: string;
  readonly displayName: string;
  readonly version: number;
  readonly eventId?: string;
  readonly relation?: { readonly id: string; readonly version: number };
}

export function useLifecycleActions(target: LifecycleTarget) {
  const client = useApiClient();
  const invalidate = useRecoveryInvalidation();
  const objectAccess = useQuery({
    queryKey: queryKeys.access(target.id),
    queryFn: ({ signal }) =>
      client.withSignal(signal).getObjectAccess(target.id),
  });
  const contextAccess = useQuery({
    queryKey: queryKeys.access(target.eventId ?? target.id),
    enabled: target.eventId !== undefined,
    queryFn: ({ signal }) =>
      client.withSignal(signal).getObjectAccess(target.eventId ?? target.id),
  });
  const relations = useQuery({
    queryKey: ["object", target.eventId, "relations"],
    enabled: target.eventId !== undefined,
    queryFn: ({ signal }) =>
      client
        .withSignal(signal)
        .listObjectRelations(target.eventId ?? target.id),
  });
  const remove = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      client.deleteRelation(id, version),
    onSuccess: invalidate,
  });
  const trash = useMutation({
    mutationFn: () => client.deleteObject(target.id, target.version),
    onSuccess: invalidate,
  });
  const inclusion =
    target.relation ??
    relations.data?.items.find(
      (relation) =>
        relation.sourceObjectId === target.eventId &&
        relation.targetObjectId === target.id &&
        relation.relationType === "includes",
    );
  return { objectAccess, contextAccess, relations, inclusion, remove, trash };
}
