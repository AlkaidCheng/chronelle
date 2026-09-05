"use client";

import type { DocumentFileInput } from "@chronelle/api-client";
import type {
  DevelopmentSignInRequest,
  EventCreatePayload,
  EventContextCreatePayload,
  EventUpdatePayload,
  ExpenseUpdatePayload,
  ObjectSearchQueryInput,
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
} from "@tanstack/react-query";

import { useApiClient } from "./api-context";
import { useAuthSession } from "./auth-session";

export const queryKeys = {
  events: ["events"] as const,
  event: (eventId: string) => ["event", eventId] as const,
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
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DevelopmentSignInRequest) => client.signIn(input),
    onSuccess: async (session) => {
      queryClient.clear();
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
    queryFn: () => client.getSession(),
    queryKey: queryKeys.session,
  });
}

export function useEventsQuery() {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: credential !== null,
    queryFn: () => client.listEvents(),
    queryKey: queryKeys.events,
  });
}

export function useObjectSearch(input: ObjectSearchQueryInput | null) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: credential !== null && input !== null,
    queryFn: () => {
      if (input === null) {
        throw new Error("Search input is required.");
      }
      return client.searchObjects(input);
    },
    queryKey: input === null ? ["search", "idle"] : queryKeys.search(input),
  });
}

type EventView =
  | "overview"
  | "todos"
  | "calendar"
  | "timeline"
  | "itinerary"
  | "expenses"
  | "reminders"
  | "files"
  | "sharing";

export function useEventWorkspaceQueries(
  eventId: string,
  activeView: EventView,
) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  const results = useQueries({
    queries: [
      {
        enabled: credential !== null,
        queryFn: () => client.getEventDetail(eventId),
        queryKey: queryKeys.detail(eventId),
      },
      {
        enabled: credential !== null && activeView === "todos",
        queryFn: () => client.getEventTodos(eventId),
        queryKey: queryKeys.todos(eventId),
      },
      {
        enabled: credential !== null && activeView === "calendar",
        queryFn: () => client.getEventCalendar(eventId),
        queryKey: queryKeys.calendar(eventId),
      },
      {
        enabled:
          credential !== null &&
          (activeView === "overview" || activeView === "timeline"),
        queryFn: () => client.getEventTimeline(eventId),
        queryKey: queryKeys.timeline(eventId),
      },
      {
        enabled: credential !== null && activeView === "itinerary",
        queryFn: () => client.getEventItinerary(eventId),
        queryKey: queryKeys.itinerary(eventId),
      },
      {
        enabled: credential !== null && activeView === "expenses",
        queryFn: () => client.getEventExpenses(eventId),
        queryKey: queryKeys.expenses(eventId),
      },
      {
        enabled: credential !== null && activeView === "reminders",
        queryFn: () => client.getEventReminders(eventId),
        queryKey: queryKeys.reminders(eventId),
      },
      {
        enabled: credential !== null,
        queryFn: () => client.getObjectAccess(eventId),
        queryKey: queryKeys.access(eventId),
      },
    ],
  });

  return {
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
    queryFn: () => client.listShares(eventId),
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

function useCanonicalInvalidation() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: (query) =>
        ["event", "events", "object", "search"].includes(
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
    queryFn: () => client.listDocumentAttachments(parentObjectId),
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

export function useUnlinkDocument() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: (relationId: string) => client.deleteRelation(relationId),
    onSuccess: invalidate,
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
  const { credential } = useAuthSession();
  const invalidate = useCanonicalInvalidation();
  const attempt = useRef<{ key: string; commandId: string } | null>(null);
  return useMutation({
    mutationFn: async (input: Input) => {
      const resource = { ...input, objectType } as Extract<
        ContextResource,
        { objectType: Type }
      >;
      const key = JSON.stringify({ credential, eventId, resource });
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
