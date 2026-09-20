import {
  QueryClient,
  QueryObserver,
  type QueryKey,
} from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { invalidateResourceQueries } from "../lib/resource-invalidation";

const resourceId = "resource";
const eventId = "first-event";
const otherEventId = "second-event";

describe("resource invalidation", () => {
  it("refreshes a pending share's person name in every sharing context", async () => {
    const client = new QueryClient();
    const shares = (displayName: string) => ({
      items: [],
      pending: [
        { id: "pending-share", person: { id: resourceId, displayName } },
      ],
    });
    const observers = [eventId, otherEventId].map((id) => {
      const queryKey = ["event", id, "shares"];
      const queryFn = vi.fn(async () => shares("Updated name"));
      client.setQueryData(queryKey, shares("Original name"));
      const observer = new QueryObserver(client, {
        queryKey,
        queryFn,
        staleTime: Infinity,
      });
      return { queryKey, queryFn, unsubscribe: observer.subscribe(() => {}) };
    });
    const todos = vi.fn(async () => ({ items: [] }));
    const todoKey = ["event", eventId, "todos"];
    client.setQueryData(todoKey, { items: [] });
    const unsubscribeTodos = new QueryObserver(client, {
      queryKey: todoKey,
      queryFn: todos,
      staleTime: Infinity,
    }).subscribe(() => {});
    try {
      await invalidateResourceQueries(client, {
        id: resourceId,
        objectType: "person",
      });
      for (const observer of observers) {
        expect(observer.queryFn).toHaveBeenCalledTimes(1);
        expect(client.getQueryData(observer.queryKey)).toEqual(
          shares("Updated name"),
        );
      }
      expect(todos).not.toHaveBeenCalled();
    } finally {
      for (const observer of observers) observer.unsubscribe();
      unsubscribeTodos();
      client.clear();
    }
  });

  it.each(["event", "task", "expense"] as const)(
    "refreshes file target labels after %s edits",
    async (objectType) => {
      const client = new QueryClient();
      const key = ["event", "context", "attachment-targets"];
      client.setQueryData(key, { tasks: [] });
      await invalidateResourceQueries(client, { id: "resource", objectType });
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      client.clear();
    },
  );
  it("refetches a task's dependent reads across contexts and filtered lists only", async () => {
    const client = new QueryClient();
    const affected = [
      ["event", eventId, "detail"],
      ["event", eventId, "todos"],
      ["event", otherEventId, "todos"],
      ["event", otherEventId, "timeline"],
      ["event", resourceId, "access"],
      ["object", resourceId, "resource"],
      ["object", resourceId, "history"],
      ["object", resourceId, "restore-preview", 1],
      ["object", otherEventId, "removed-relations"],
      ["tasks", { status: "todo" }],
      ["tasks", { status: "done" }],
      ["search", { query: "changed name" }],
    ];
    const unaffected = [
      ["events"],
      ["event", eventId, "resource"],
      ["event", eventId, "access"],
      ["event", eventId, "layout"],
      ["event", eventId, "layout", "history"],
      ["event", eventId, "expenses"],
      ["event", eventId, "calendar"],
      ["event", eventId, "itinerary"],
      ["event", eventId, "notes", "updated"],
      ["event", eventId, "sections"],
      ["object", "another-task", "resource"],
      ["object", "another-task", "history"],
      ["object", "another-task", "documents"],
      ["labels"],
      ["persons"],
      ["session"],
      ["trash"],
    ];
    const observers = [...affected, ...unaffected].map((queryKey) => {
      const queryFn = vi.fn(async () => ({ items: [] }));
      client.setQueryData(queryKey, { items: [] });
      const observer = new QueryObserver(client, {
        queryKey,
        queryFn,
        staleTime: Infinity,
      });
      return { queryFn, unsubscribe: observer.subscribe(() => {}) };
    });
    try {
      await invalidateResourceQueries(client, {
        id: resourceId,
        objectType: "task",
      });
      for (const [index, observer] of observers.entries())
        expect(observer.queryFn).toHaveBeenCalledTimes(
          index < affected.length ? 1 : 0,
        );
    } finally {
      for (const observer of observers) observer.unsubscribe();
      client.clear();
    }
  });

  it.each([
    ["event", ["detail", "calendar", "itinerary", "timeline"]],
    ["task", ["detail", "todos", "timeline"]],
    ["expense", ["detail", "expenses", "timeline"]],
    ["reminder", ["detail", "reminders", "timeline"]],
    ["person", ["detail", "people", "shares"]],
    ["note", ["detail", "notes"]],
    ["document", ["detail"]],
  ] as const)(
    "invalidates all %s projections even when their cached lists are empty",
    async (objectType, views) => {
      const client = new QueryClient();
      const allViews = [
        "detail",
        "calendar",
        "itinerary",
        "timeline",
        "todos",
        "expenses",
        "reminders",
        "people",
        "shares",
        "notes",
        "resource",
        "access",
        "layout",
      ];
      const keys = allViews.flatMap((view) => [
        ["event", eventId, view],
        ["event", otherEventId, view],
      ]);
      for (const key of keys) client.setQueryData(key, { items: [] });
      await invalidateResourceQueries(client, { id: resourceId, objectType });
      for (const key of keys)
        expect(client.getQueryState(key)?.isInvalidated).toBe(
          (views as readonly string[]).includes(String(key[2])),
        );
      client.clear();
    },
  );

  it("refreshes event names in task contexts and every person's event list", async () => {
    const client = new QueryClient();
    const keys: QueryKey[] = [
      ["event", resourceId, "resource"],
      ["events", { query: "new name" }],
      ["tasks", { query: "task" }],
      ["object", "first-person", "resource", "events"],
      ["object", "second-person", "resource", "events"],
    ];
    for (const key of keys) client.setQueryData(key, {});
    await invalidateResourceQueries(client, {
      id: resourceId,
      objectType: "event",
    });
    for (const key of keys)
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    client.clear();
  });
});
