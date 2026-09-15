"use client";

import type {
  ChronelleApiClient,
  DocumentFileInput,
} from "@chronelle/api-client";
import type {
  DevelopmentSignInRequest,
  EventCreatePayload,
  EventContextCreatePayload,
  EventUpdatePayload,
  EventListQueryInput,
  EventListResponse,
  TaskListQueryInput,
  TaskListResponse,
  EventResponse,
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
  objectResource: (objectId: string) =>
    ["object", objectId, "resource"] as const,
  detail: (eventId: string) => ["event", eventId, "detail"] as const,
  todos: (eventId: string) => ["event", eventId, "todos"] as const,
  calendar: (eventId: string) => ["event", eventId, "calendar"] as const,
  timeline: (eventId: string) => ["event", eventId, "timeline"] as const,
  itinerary: (eventId: string) => ["event", eventId, "itinerary"] as const,
  expenses: (eventId: string) => ["event", eventId, "expenses"] as const,
  reminders: (eventId: string) => ["event", eventId, "reminders"] as const,
  search: (input: ObjectSearchQueryInput) => ["search", input] as const,
  tasks: ["tasks"] as const,
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
      // The proxy set the session cookie; only the workspace is kept here.
      startSession({ workspaceId: session.workspace.id });
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

function selectTaskItems(data: InfiniteData<TaskListResponse>) {
  return { items: pageItems(data.pages), asOf: data.pages[0]?.asOf };
}

/** The workspace Task collection: every task the user may view, page by page. */
export function useTasksQuery(input: Omit<TaskListQueryInput, "cursor">) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  const queryClient = useQueryClient();
  const queryKey = [
    ...queryKeys.tasks,
    input,
    credential?.homeWorkspaceId,
    credential?.workspaceId,
  ];
  const result = useInfiniteQuery({
    enabled: credential !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.withSignal(signal).listTasks({
        ...input,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryKey,
    select: selectTaskItems,
  });
  return {
    ...result,
    refresh: () => queryClient.resetQueries({ queryKey, exact: true }),
  };
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
  refetchOnMount: true | "always" = true,
) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  const event = useQuery({
    enabled: credential !== null,
    queryFn: ({ signal }) => client.withSignal(signal).getEvent(eventId),
    queryKey: queryKeys.eventResource(eventId),
    refetchOnMount,
  });
  const detail = useQuery({
    enabled:
      credential !== null &&
      (activeView === "overview" || activeView === "sharing"),
    queryFn: ({ signal }) => client.withSignal(signal).getEventDetail(eventId),
    queryKey: queryKeys.detail(eventId),
  });
  const access = useQuery({
    enabled: credential !== null,
    queryFn: ({ signal }) => client.withSignal(signal).getObjectAccess(eventId),
    queryKey: queryKeys.access(eventId),
    refetchOnMount,
  });
  return { event, detail, access };
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

export function useTaskEditorQueries(taskId: string) {
  const { resource: task, access } = useObjectEditorQueries(
    taskId,
    (client, id) => client.getTask(id),
  );
  return { task, access };
}

export function useExpenseEditorQueries(expenseId: string) {
  const { resource: expense, access } = useObjectEditorQueries(
    expenseId,
    (client, id) => client.getExpense(id),
  );
  return { expense, access };
}

export function useReminderEditorQueries(reminderId: string) {
  const { resource: reminder, access } = useObjectEditorQueries(
    reminderId,
    (client, id) => client.getReminder(id),
  );
  return { reminder, access };
}

function useObjectEditorQueries<Resource>(
  id: string,
  read: (client: ChronelleApiClient, id: string) => Promise<Resource>,
) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  const resource = useQuery({
    enabled: credential !== null,
    queryFn: ({ signal }) => read(client.withSignal(signal), id),
    queryKey: queryKeys.objectResource(id),
    refetchOnMount: "always",
  });
  const access = useQuery({
    enabled: credential !== null,
    queryFn: ({ signal }) => client.withSignal(signal).getObjectAccess(id),
    queryKey: queryKeys.access(id),
    refetchOnMount: "always",
  });
  return { resource, access };
}

/** Refreshes an Event's reads, or the workspace collections when no Event is given. */
export function useRefreshEvent(
  eventId: string | undefined,
  options: { readonly throwOnError?: boolean } = {},
) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      eventId === undefined
        ? queryClient.invalidateQueries({ queryKey: queryKeys.tasks }, options)
        : queryClient.invalidateQueries(
            { queryKey: queryKeys.event(eventId) },
            options,
          ),
      queryClient.invalidateQueries({ queryKey: queryKeys.events }, options),
    ]);
  };
}

export function useCanonicalInvalidation() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: (query) =>
        ["event", "events", "object", "search", "tasks", "trash"].includes(
          String(query.queryKey[0]),
        ),
    });
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
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useUpdateEvent() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { signal } = useAuthSession();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: EventUpdatePayload }) =>
      client.updateEvent(id, input),
    onSuccess: async (saved) => {
      const queryKey = queryKeys.eventResource(saved.id);
      await queryClient.cancelQueries({ queryKey, exact: true });
      if (signal.aborted) return;
      queryClient.setQueryData<EventResponse>(queryKey, (current) =>
        current && current.version > saved.version ? current : saved,
      );
      void invalidate();
    },
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

/** Retains the identity of an unchanged linked-create retry. */
export interface ContextCreateAttempt {
  current: { readonly key: string; readonly commandId: string } | null;
}

// Without an Event the resource is created on its own; only Tasks live
// outside an Event today.
function useCreateInContext<Type extends ContextResource["objectType"]>(
  eventId: string | undefined,
  objectType: Type,
  retainedAttempt?: ContextCreateAttempt,
) {
  type Input = Omit<
    Extract<ContextResource, { objectType: Type }>,
    "objectType"
  >;
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  const localAttempt = useRef<ContextCreateAttempt["current"]>(null);
  const attempt = retainedAttempt ?? localAttempt;
  return useMutation({
    mutationFn: async (input: Input) => {
      const resource = { ...input, objectType } as Extract<
        ContextResource,
        { objectType: Type }
      >;
      if (eventId === undefined) {
        if (resource.objectType !== "task")
          throw new Error("Only a Task can be created outside an Event.");
        const { objectType: _type, ...payload } = resource as Extract<
          ContextResource,
          { objectType: "task" }
        >;
        return client.createTask(payload);
      }
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
    onSuccess: () => {
      attempt.current = null;
      // A confirmed write settles independently of projection refreshes.
      void invalidate();
    },
  });
}

export function useCreateScheduledEvent(
  eventId: string,
  attempt?: ContextCreateAttempt,
) {
  return useCreateInContext(eventId, "event", attempt);
}

export function useCreateTask(
  eventId: string | undefined,
  attempt?: ContextCreateAttempt,
) {
  return useCreateInContext(eventId, "task", attempt);
}

export function useUpdateTask() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TaskUpdatePayload }) =>
      client.updateTask(id, input),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useCreateExpense(
  eventId: string,
  attempt?: ContextCreateAttempt,
) {
  return useCreateInContext(eventId, "expense", attempt);
}

export function useUpdateExpense() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ExpenseUpdatePayload }) =>
      client.updateExpense(id, input),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useCreateReminder(
  eventId: string,
  attempt?: ContextCreateAttempt,
) {
  return useCreateInContext(eventId, "reminder", attempt);
}

export function useUpdateReminder() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReminderUpdatePayload }) =>
      client.updateReminder(id, input),
    onSuccess: () => {
      void invalidate();
    },
  });
}
