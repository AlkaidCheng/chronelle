"use client";

import type { RevisionRestoreRequest } from "@chronelle/schemas";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";

import { useApiClient } from "./api-context";
import { useAuthSession } from "./auth-session";
import { useCanonicalInvalidation } from "./queries";

export function useObjectHistory(objectId: string) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useInfiniteQuery({
    queryKey: ["object", objectId, "history"],
    enabled: credential !== null,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.withSignal(signal).listObjectRevisions(objectId, {
        limit: 20,
        ...(pageParam === undefined ? {} : { beforeVersion: pageParam }),
      }),
    getNextPageParam: (page) => page.nextBeforeVersion ?? undefined,
  });
}

export function useRevisionComparison(
  objectId: string,
  fromVersion: number | null,
  toVersion: number | null,
) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    queryKey: ["object", objectId, "comparison", fromVersion, toVersion],
    enabled: credential !== null && fromVersion !== null && toVersion !== null,
    queryFn: ({ signal }) => {
      if (fromVersion === null || toVersion === null)
        throw new Error("Select both revisions.");
      return client.withSignal(signal).compareObjectRevisions(objectId, {
        fromVersion,
        toVersion,
      });
    },
  });
}

export function useRestorePreview(objectId: string, version: number | null) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    queryKey: ["object", objectId, "restore-preview", version],
    enabled: credential !== null && version !== null,
    queryFn: ({ signal }) => {
      if (version === null) throw new Error("Select a revision.");
      return client
        .withSignal(signal)
        .previewObjectRestoration(objectId, version);
    },
    staleTime: 0,
  });
}

export function useRestoreRevision(objectId: string) {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: ({
      version,
      ...input
    }: RevisionRestoreRequest & { version: number }) =>
      client.restoreObjectRevision(objectId, version, input),
    onSuccess: invalidate,
  });
}
