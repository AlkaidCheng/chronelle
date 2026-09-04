"use client";

import type { DocumentFileInput } from "@chronelle/api-client";
import type {
  DevelopmentSignInRequest,
  EventCreatePayload,
  EventUpdatePayload,
  ExpenseCreatePayload,
  ExpenseUpdatePayload,
  PermissionScopeUpdatePayload,
  ReminderCreatePayload,
  ReminderUpdatePayload,
  ShareCreatePayload,
  TaskCreatePayload,
  TaskUpdatePayload,
} from "@chronelle/schemas";
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

export function useEventWorkspaceQueries(eventId: string) {
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
        enabled: credential !== null,
        queryFn: () => client.getEventTodos(eventId),
        queryKey: queryKeys.todos(eventId),
      },
      {
        enabled: credential !== null,
        queryFn: () => client.getEventCalendar(eventId),
        queryKey: queryKeys.calendar(eventId),
      },
      {
        enabled: credential !== null,
        queryFn: () => client.getEventTimeline(eventId),
        queryKey: queryKeys.timeline(eventId),
      },
      {
        enabled: credential !== null,
        queryFn: () => client.getEventItinerary(eventId),
        queryKey: queryKeys.itinerary(eventId),
      },
      {
        enabled: credential !== null,
        queryFn: () => client.getEventExpenses(eventId),
        queryKey: queryKeys.expenses(eventId),
      },
      {
        enabled: credential !== null,
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

export function useAttachDocument(eventId: string, parentObjectId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: DocumentFileInput) =>
      client.attachDocument(parentObjectId, file),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.attachments(parentObjectId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.detail(eventId) }),
      ]);
    },
  });
}

export function useDownloadDocument() {
  const client = useApiClient();
  return useMutation({
    mutationFn: (documentId: string) => client.downloadDocument(documentId),
  });
}

export function useUnlinkDocument(eventId: string, parentObjectId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (relationId: string) => client.deleteRelation(relationId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.attachments(parentObjectId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.detail(eventId) }),
      ]);
    },
  });
}

export function useCreateEvent() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EventCreatePayload) => client.createEvent(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events });
    },
  });
}

export function useUpdateEvent(eventId: string) {
  const client = useApiClient();
  const invalidate = useEventInvalidation(eventId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: EventUpdatePayload }) =>
      client.updateEvent(id, input),
    onSuccess: invalidate,
  });
}

export function useShareResource(eventId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ShareCreatePayload, "resourceId">) =>
      client.shareResource({ ...input, resourceId: eventId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.shares(eventId),
      });
    },
  });
}

export function useRevokeShare(eventId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) => client.revokeShare(grantId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.shares(eventId),
      });
    },
  });
}

export function useUpdatePermissionScope(eventId: string) {
  const client = useApiClient();
  const invalidate = useEventInvalidation(eventId);
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

async function includeResource(
  eventId: string,
  create: () => Promise<{ readonly id: string }>,
  createRelation: (eventId: string, targetObjectId: string) => Promise<unknown>,
) {
  const resource = await create();
  await createRelation(eventId, resource.id);
  return resource;
}

export function useCreateScheduledEvent(eventId: string) {
  const client = useApiClient();
  const invalidate = useEventInvalidation(eventId);
  return useMutation({
    mutationFn: (input: Omit<EventCreatePayload, "permissionScopeId">) =>
      includeResource(
        eventId,
        () => client.createEvent({ ...input, permissionScopeId: eventId }),
        (sourceId, targetObjectId) =>
          client.createRelation(sourceId, {
            relationType: "includes",
            targetObjectId,
          }),
      ),
    onSuccess: invalidate,
  });
}

export function useCreateTask(eventId: string) {
  const client = useApiClient();
  const invalidate = useEventInvalidation(eventId);
  return useMutation({
    mutationFn: (input: Omit<TaskCreatePayload, "permissionScopeId">) =>
      includeResource(
        eventId,
        () => client.createTask({ ...input, permissionScopeId: eventId }),
        (sourceId, targetObjectId) =>
          client.createRelation(sourceId, {
            relationType: "includes",
            targetObjectId,
          }),
      ),
    onSuccess: invalidate,
  });
}

export function useUpdateTask(eventId: string) {
  const client = useApiClient();
  const invalidate = useEventInvalidation(eventId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TaskUpdatePayload }) =>
      client.updateTask(id, input),
    onSuccess: invalidate,
  });
}

export function useCreateExpense(eventId: string) {
  const client = useApiClient();
  const invalidate = useEventInvalidation(eventId);
  return useMutation({
    mutationFn: (input: Omit<ExpenseCreatePayload, "permissionScopeId">) =>
      includeResource(
        eventId,
        () => client.createExpense({ ...input, permissionScopeId: eventId }),
        (sourceId, targetObjectId) =>
          client.createRelation(sourceId, {
            relationType: "includes",
            targetObjectId,
          }),
      ),
    onSuccess: invalidate,
  });
}

export function useUpdateExpense(eventId: string) {
  const client = useApiClient();
  const invalidate = useEventInvalidation(eventId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ExpenseUpdatePayload }) =>
      client.updateExpense(id, input),
    onSuccess: invalidate,
  });
}

export function useCreateReminder(eventId: string) {
  const client = useApiClient();
  const invalidate = useEventInvalidation(eventId);
  return useMutation({
    mutationFn: (input: Omit<ReminderCreatePayload, "permissionScopeId">) =>
      includeResource(
        eventId,
        () => client.createReminder({ ...input, permissionScopeId: eventId }),
        (sourceId, targetObjectId) =>
          client.createRelation(sourceId, {
            relationType: "includes",
            targetObjectId,
          }),
      ),
    onSuccess: invalidate,
  });
}

export function useUpdateReminder(eventId: string) {
  const client = useApiClient();
  const invalidate = useEventInvalidation(eventId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReminderUpdatePayload }) =>
      client.updateReminder(id, input),
    onSuccess: invalidate,
  });
}
