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
  LabelCreateRequest,
  PersonCreatePayload,
  PersonListQueryInput,
  PersonUpdatePayload,
  LabelUpdateRequest,
  EventResponse,
  ExpenseUpdatePayload,
  ObjectSearchQueryInput,
  ObjectSearchResponse,
  PermissionScopeUpdatePayload,
  PreferencesRequest,
  ReminderUpdatePayload,
  SessionResponse,
  ShareCreatePayload,
  TaskResponse,
  TaskUpdatePayload,
  UserResponse,
} from "@chronelle/schemas";
import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
  type InfiniteData,
} from "@tanstack/react-query";

import {
  localeChoiceOf,
  readLocaleChoice,
  writeLocaleChoice,
} from "../i18n/locale-preference";
import { isLocale } from "../i18n/locales";
import { useApiClient } from "./api-context";
import { personDisplayName } from "./person-fields";
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
  people: (eventId: string) => ["event", eventId, "people"] as const,
  search: (input: ObjectSearchQueryInput) => ["search", input] as const,
  tasks: ["tasks"] as const,
  labels: ["labels"] as const,
  persons: ["persons"] as const,
  access: (eventId: string) => ["event", eventId, "access"] as const,
  shares: (eventId: string) => ["event", eventId, "shares"] as const,
  attachments: (parentObjectId: string) =>
    ["object", parentObjectId, "documents"] as const,
  session: ["session"] as const,
};

export function useDevelopmentSignIn() {
  const client = useApiClient();
  const { startSession } = useAuthSession();
  const adoptLocale = useAdoptAccountLocale();
  return useMutation({
    mutationFn: (input: DevelopmentSignInRequest) => client.signIn(input),
    onSuccess: async (session) => {
      adoptLocale(session.user);
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

/**
 * Keeps the browser's language and the account's the same. An account
 * with a language puts it on this browser before the workspace renders;
 * an account without one learns the choice this browser already made, so
 * a language picked on the sign-in screen follows the person from then on.
 */
export function useAdoptAccountLocale() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  return useCallback(
    (user: Pick<UserResponse, "locale">) => {
      const browser = readLocaleChoice();
      if (user.locale !== null) {
        // A language this build does not speak leaves the browser's alone.
        if (!isLocale(user.locale)) return;
        const account = localeChoiceOf(user.locale);
        if (account === browser) return;
        writeLocaleChoice(account);
        router.refresh();
        return;
      }
      if (browser === "system") return;
      void client
        .updatePreferences({ locale: browser })
        .then((updated) => {
          queryClient.setQueryData<SessionResponse>(
            queryKeys.session,
            (session) =>
              session === undefined ? session : { ...session, user: updated },
          );
        })
        .catch(() => {
          // The account keeps no language for now; the browser's still applies.
        });
    },
    [client, queryClient, router],
  );
}

/**
 * Changes the preferences kept on the account. The session reflects the
 * change at once and again from the server's reply; a refusal puts the
 * previous values back.
 */
export function useUpdatePreferences() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PreferencesRequest) => client.updatePreferences(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.session });
      const previous = queryClient.getQueryData<SessionResponse>(
        queryKeys.session,
      );
      if (previous !== undefined)
        queryClient.setQueryData<SessionResponse>(queryKeys.session, {
          ...previous,
          user: {
            ...previous.user,
            ...(input.locale !== undefined && { locale: input.locale }),
            ...(input.timeZone !== undefined && { timeZone: input.timeZone }),
            ...(input.hourCycle !== undefined && {
              hourCycle: input.hourCycle,
            }),
            ...(input.weekStart !== undefined && {
              weekStart: input.weekStart,
            }),
          },
        });
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous !== undefined)
        queryClient.setQueryData(queryKeys.session, context.previous);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<SessionResponse>(queryKeys.session, (session) =>
        session === undefined ? session : { ...session, user: updated },
      );
    },
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
  const merged = <Key extends "contexts" | "progress" | "parents">(key: Key) =>
    Object.assign(
      {},
      ...data.pages.map((page) => page[key]),
    ) as TaskListResponse[Key];
  return {
    items: pageItems(data.pages),
    contexts: merged("contexts"),
    progress: merged("progress"),
    parents: merged("parents"),
    asOf: data.pages[0]?.asOf,
  };
}

/** The workspace's labels in name order, by id and as a list. */
export function useLabelsQuery() {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: credential !== null,
    queryFn: ({ signal }) => client.withSignal(signal).listLabels(),
    queryKey: [...queryKeys.labels, credential?.workspaceId],
    select: (page) => ({
      items: page.items,
      names: new Map(page.items.map((label) => [label.id, label.name])),
    }),
  });
}

/** The workspace's people in name order, by id and as a list. */
export function usePersonsQuery(
  enabled = true,
  input: PersonListQueryInput = {},
) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: enabled && credential !== null,
    queryFn: ({ signal }) => client.withSignal(signal).listPersons(input),
    queryKey: [...queryKeys.persons, credential?.workspaceId, input],
    select: (page) => ({
      items: page.items,
      names: new Map(
        page.items.map((person) => [person.id, personDisplayName(person)]),
      ),
    }),
  });
}

/**
 * Creates a person on its own. An unchanged retry after a lost response
 * reuses the same command id, so the API returns the person it already
 * created instead of a second one.
 */
export function useCreatePerson(retainedAttempt?: ContextCreateAttempt) {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  const localAttempt = useRef<ContextCreateAttempt["current"]>(null);
  const attempt = retainedAttempt ?? localAttempt;
  return useMutation({
    mutationFn: (input: PersonCreatePayload) =>
      client.createPerson({
        ...input,
        commandId: commandFor(attempt, { person: input }),
      }),
    onSuccess: () => {
      attempt.current = null;
      void invalidate();
    },
  });
}

/** The command id of an unchanged attempt, or a fresh one for new input. */
function commandFor(attempt: ContextCreateAttempt, input: unknown): string {
  const key = JSON.stringify(input);
  if (attempt.current?.key !== key)
    attempt.current = { key, commandId: crypto.randomUUID() };
  return attempt.current.commandId;
}

/** Creates a person inside an Event: the person and its inclusion in one command. */
export function useCreatePersonInEvent(
  eventId: string,
  attempt?: ContextCreateAttempt,
) {
  return useCreateInContext(eventId, "person", attempt);
}

/** Includes a person the workspace already knows in an Event. */
export function useIncludePerson(eventId: string) {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: (personId: string) =>
      client.createRelation(eventId, {
        relationType: "includes",
        targetObjectId: personId,
      }),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useUpdatePerson() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PersonUpdatePayload }) =>
      client.updatePerson(id, input),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useCreateLabel() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: (input: LabelCreateRequest) => client.createLabel(input),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useUpdateLabel() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: LabelUpdateRequest }) =>
      client.updateLabel(id, input),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useDeleteLabel() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: ({
      id,
      expectedVersion,
    }: {
      id: string;
      expectedVersion: number;
    }) => client.deleteLabel(id, expectedVersion),
    onSuccess: () => {
      void invalidate();
    },
  });
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
  const access = useEventAccessQuery(eventId, refetchOnMount);
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

export function usePersonEditorQueries(personId: string) {
  const { resource: person, access } = useObjectEditorQueries(
    personId,
    (client, id) => client.getPerson(id),
  );
  return { person, access };
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
        [
          "event",
          "events",
          "object",
          "search",
          "tasks",
          "labels",
          "persons",
          "trash",
        ].includes(String(query.queryKey[0])),
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

/** The caller's actions on an Event. */
export function useEventAccessQuery(
  eventId: string,
  refetchOnMount: true | "always" = true,
) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: credential !== null,
    queryFn: ({ signal }) => client.withSignal(signal).getObjectAccess(eventId),
    queryKey: queryKeys.access(eventId),
    refetchOnMount,
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
        return client.createTask({
          ...payload,
          commandId: commandFor(attempt, { standalone: resource }),
        });
      }
      const result = await client.createEventResource(eventId, {
        commandId: commandFor(attempt, { eventId, resource }),
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

/**
 * Creates a copy of a task at a given place in manual order: its fields and
 * labels, not its subtasks, inside the same Event when it has one.
 */
export function useDuplicateTask() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: async ({
      eventId,
      rank,
      task,
    }: {
      readonly eventId: string | undefined;
      readonly rank: string;
      readonly task: TaskResponse;
    }) => {
      const fields = {
        displayName: `${task.displayName} (copy)`.slice(0, 240),
        dueOn: task.dueOn,
        dueAt: task.dueAt,
        durationMinutes: task.durationMinutes,
        repeatRule: task.repeatRule,
        repeatUntil: task.repeatUntil,
        parentTaskId: task.parentTaskId,
        assigneeId: task.assigneeId,
        location: task.location,
        labelIds: [...task.labelIds],
        rank,
      };
      if (eventId === undefined)
        return client.createTask({ ...fields, commandId: crypto.randomUUID() });
      const result = await client.createEventResource(eventId, {
        commandId: crypto.randomUUID(),
        resource: { objectType: "task", ...fields },
      });
      return result.resource;
    },
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
