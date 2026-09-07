"use client";

import type { DocumentFileInput } from "@chronelle/api-client";
import type {
  DevelopmentSignInRequest,
  EventCreatePayload,
  EventContextCreatePayload,
  EventUpdatePayload,
  EventListQueryInput,
  EventListResponse,
  ExpenseUpdatePayload,
  ObjectSearchQueryInput,
  ObjectSearchResponse,
  PermissionScopeUpdatePayload,
  ReminderUpdatePayload,
  ShareCreatePayload,
  TaskUpdatePayload,
} from "@chronelle/schemas";
import { useRef } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
  type InfiniteData,
} from "@tanstack/react-query";

import { useApiClient } from "./api-context";
import { useAuthSession } from "./auth-session";
import type { EventView } from "./event-views";

export const queryKeys = {
  events: ["events"] as const,
  event: (eventId: string) => ["event", eventId] as const,
  eventResource: (eventId: string) => ["event", eventId, "resource"] as const,
  detail: (eventId: string) => ["event", eventId, "detail"] as const,
  todos: (eventId: string) => ["event", eventId, "todos"] as const,
  calendar: (eventId: string) => ["event", eventId, "calendar"] as const,
  timeline: (eventId: string) => ["event", eventId, "timeline"] as const,
  itinerary: (eventId: string) => ["event", eventId, "itinerary"] as const,
  expenses: (eventId: string) => ["event", eventId, "expenses"] as const,
  reminders: (eventId: string) => ["event", eventId, "reminders"] as const,
  search: (input: ObjectSearchQueryInput) => ["search", input] as const,
  access: (eventId: string) => ["event", eventId, "access"] as const,
  shares: (eventId: string) => ["event", eventId, "shares"] as const,
  attachments: (parentObjectId: string) =>
    ["object", parentObjectId, "documents"] as const,
  session: ["session"] as const,
};

export function useDevelopmentSignIn() {
  const client = useApiClient();
  const { startSession } = useAuthSession();
  return useMutation({
    mutationFn: (input: DevelopmentSignInRequest) => client.signIn(input),
    onSuccess: async (session) => {
      startSession({
        accessToken: session.accessToken,
        workspaceId: session.workspace.id,
      });
    },
  });
}

export function useSessionQuery() {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: credential !== null,
    queryFn: ({ signal }) => client.withSignal(signal).getSession(),
    queryKey: queryKeys.session,
  });
}

export function useEventsQuery(input: Omit<EventListQueryInput, "cursor">) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  const queryClient = useQueryClient();
  const queryKey = [
    ...queryKeys.events,
    input,
    credential?.homeWorkspaceId,
    credential?.workspaceId,
  ];
  const result = useInfiniteQuery({
    enabled: credential !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.withSignal(signal).listEvents({
        ...input,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryKey,
    select: selectEventItems,
  });
  return {
    ...result,
    refresh: () => queryClient.resetQueries({ queryKey, exact: true }),
  };
}

function pageItems<T extends { readonly id: string }>(
  pages: readonly { readonly items: readonly T[] }[],
): T[] {
  const items = new Map(
    pages.flatMap((page) => page.items.map((item) => [item.id, item] as const)),
  );
  return [...items.values()];
}

function selectEventItems(data: InfiniteData<EventListResponse>) {
  return { items: pageItems(data.pages), asOf: data.pages[0]?.asOf };
}

function selectSearchItems(data: InfiniteData<ObjectSearchResponse>) {
  return { items: pageItems(data.pages) };
}

export function useObjectSearch(
  input: Omit<ObjectSearchQueryInput, "cursor"> | null,
) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useInfiniteQuery({
    enabled: credential !== null && input !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      if (input === null) {
        throw new Error("Search input is required.");
      }
      return client.withSignal(signal).searchObjects({
        ...input,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      });
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryKey: [
      ...(input === null ? ["search", "idle"] : queryKeys.search(input)),
      credential?.homeWorkspaceId,
      credential?.workspaceId,
    ],
    select: selectSearchItems,
  });
}

export function useEventWorkspaceQueries(
  eventId: string,
  activeView: EventView | null,
) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  const event = useQuery({
    enabled: credential !== null,
    queryFn: ({ signal }) => client.withSignal(signal).getEvent(eventId),
    queryKey: queryKeys.eventResource(eventId),
  });
  const results = useQueries({
    queries: [
      {
        enabled:
          credential !== null &&
          (activeView === "overview" ||
            activeView === "files" ||
            activeView === "sharing"),
        queryFn: ({ signal }) =>
          client.withSignal(signal).getEventDetail(eventId),
        queryKey: queryKeys.detail(eventId),
      },
      {
        enabled: credential !== null && activeView === "todos",
        queryFn: ({ signal }) =>
          client.withSignal(signal).getEventTodos(eventId),
        queryKey: queryKeys.todos(eventId),
      },
      {
        enabled: credential !== null && activeView === "calendar",
        queryFn: ({ signal }) =>
          client.withSignal(signal).getEventCalendar(eventId),
        queryKey: queryKeys.calendar(eventId),
      },
      {
        enabled: credential !== null && activeView === "timeline",
        queryFn: ({ signal }) =>
          client.withSignal(signal).getEventTimeline(eventId),
        queryKey: queryKeys.timeline(eventId),
      },
      {
        enabled: credential !== null && activeView === "itinerary",
        queryFn: ({ signal }) =>
          client.withSignal(signal).getEventItinerary(eventId),
        queryKey: queryKeys.itinerary(eventId),
      },
      {
        enabled: credential !== null && activeView === "expenses",
        queryFn: ({ signal }) =>
          client.withSignal(signal).getEventExpenses(eventId),
        queryKey: queryKeys.expenses(eventId),
      },
      {
        enabled: credential !== null && activeView === "reminders",
        queryFn: ({ signal }) =>
          client.withSignal(signal).getEventReminders(eventId),
        queryKey: queryKeys.reminders(eventId),
      },
      {
        enabled: credential !== null,
        queryFn: ({ signal }) =>
          client.withSignal(signal).getObjectAccess(eventId),
        queryKey: queryKeys.access(eventId),
      },
    ],
  });

  return {
    event,
    calendar: results[2],
    detail: results[0],
    expenses: results[5],
    itinerary: results[4],
    reminders: results[6],
    access: results[7],
    timeline: results[3],
    todos: results[1],
  };
}

export function useSharesQuery(eventId: string, enabled: boolean) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: enabled && credential !== null,
    queryFn: ({ signal }) => client.withSignal(signal).listShares(eventId),
    queryKey: queryKeys.shares(eventId),
  });
}

function useEventInvalidation(eventId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.event(eventId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.events }),
    ]);
  };
}

export function useCanonicalInvalidation() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: (query) =>
        ["event", "events", "object", "search", "trash"].includes(
          String(query.queryKey[0]),
        ),
    });
}

export function useRefreshEvent(eventId: string) {
  return useEventInvalidation(eventId);
}

export function useDocumentAttachments(parentObjectId: string) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: credential !== null,
    queryFn: ({ signal }) =>
      client.withSignal(signal).listDocumentAttachments(parentObjectId),
    queryKey: queryKeys.attachments(parentObjectId),
  });
}

export function useAttachDocument(parentObjectId: string) {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: (file: DocumentFileInput) =>
      client.attachDocument(parentObjectId, file),
    onSuccess: invalidate,
  });
}

export function useDownloadDocument() {
  const client = useApiClient();
  return useMutation({
    mutationFn: (documentId: string) => client.downloadDocument(documentId),
  });
}

export function useCreateEvent() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: (input: EventCreatePayload) => client.createEvent(input),
    onSuccess: invalidate,
  });
}

export function useUpdateEvent() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: EventUpdatePayload }) =>
      client.updateEvent(id, input),
    onSuccess: invalidate,
  });
}

export function useShareResource(eventId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: (input: Omit<ShareCreatePayload, "resourceId">) =>
      client.shareResource({ ...input, resourceId: eventId }),
    onSuccess: async () => {
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: queryKeys.session }),
      ]);
    },
  });
}

export function useRevokeShare() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: (grantId: string) => client.revokeShare(grantId),
    onSuccess: async () => {
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: queryKeys.session }),
      ]);
    },
  });
}

export function useUpdatePermissionScope() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: PermissionScopeUpdatePayload;
    }) => client.updatePermissionScope(id, input),
    onSuccess: invalidate,
  });
}

type ContextResource = EventContextCreatePayload["resource"];

function useCreateInContext<Type extends ContextResource["objectType"]>(
  eventId: string,
  objectType: Type,
) {
  type Input = Omit<
    Extract<ContextResource, { objectType: Type }>,
    "objectType"
  >;
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  const attempt = useRef<{ key: string; commandId: string } | null>(null);
  return useMutation({
    mutationFn: async (input: Input) => {
      const resource = { ...input, objectType } as Extract<
        ContextResource,
        { objectType: Type }
      >;
      const key = JSON.stringify({ eventId, resource });
      if (attempt.current?.key !== key) {
        attempt.current = { key, commandId: crypto.randomUUID() };
      }
      const result = await client.createEventResource(eventId, {
        commandId: attempt.current.commandId,
        resource,
      });
      return result.resource;
    },
    onSuccess: async () => {
      await invalidate();
      attempt.current = null;
    },
  });
}

export function useCreateScheduledEvent(eventId: string) {
  return useCreateInContext(eventId, "event");
}

export function useCreateTask(eventId: string) {
  return useCreateInContext(eventId, "task");
}

export function useUpdateTask() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TaskUpdatePayload }) =>
      client.updateTask(id, input),
    onSuccess: invalidate,
  });
}

export function useCreateExpense(eventId: string) {
  return useCreateInContext(eventId, "expense");
}

export function useUpdateExpense() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ExpenseUpdatePayload }) =>
      client.updateExpense(id, input),
    onSuccess: invalidate,
  });
}

export function useCreateReminder(eventId: string) {
  return useCreateInContext(eventId, "reminder");
}

export function useUpdateReminder() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReminderUpdatePayload }) =>
      client.updateReminder(id, input),
    onSuccess: invalidate,
  });
}
