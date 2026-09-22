import { describe, expect, it } from "vitest";

import type { TaroStorage } from "../src/auth/session-store";
import {
  EventDraftStore,
  eventDraftLifetimeMs,
  eventDraftStorageKey,
  maximumEventDrafts,
  type EventDraftSnapshot,
} from "../src/events/draft-store";
import { emptyEventFields } from "../src/events/editor";

class MemoryStorage implements TaroStorage {
  readonly values = new Map<string, unknown>();

  async getStorage({ key }: { readonly key: string }) {
    if (!this.values.has(key)) throw new Error("missing");
    return { data: this.values.get(key) };
  }

  async removeStorage({ key }: { readonly key: string }) {
    this.values.delete(key);
  }

  async setStorage({
    key,
    data,
  }: {
    readonly key: string;
    readonly data: unknown;
  }) {
    this.values.set(key, structuredClone(data));
  }
}

const userId = "019d6e7d-0000-7000-8000-000000000001";
const workspaceId = "019d6e7d-0000-7000-8000-000000000002";

function draft(
  index: number,
  change: Partial<EventDraftSnapshot> = {},
): EventDraftSnapshot {
  const baseline = emptyEventFields("UTC", new Date(2030, 0, 1));
  return {
    baseline,
    commandId: `019d6e7d-0000-7000-8000-${String(index).padStart(12, "0")}`,
    eventId: null,
    fields: { ...baseline, displayName: `Draft ${index}` },
    sourceVersion: null,
    updatedAt: new Date(Date.UTC(2030, 0, 1, 0, index)).toISOString(),
    userId,
    workspaceId,
    ...change,
  };
}

describe("Mini Program Event draft store", () => {
  it("scopes drafts by account, workspace, and canonical Event", async () => {
    const storage = new MemoryStorage();
    const store = new EventDraftStore(
      storage,
      () => new Date("2030-01-02T00:00:00.000Z"),
    );
    const first = draft(1);
    const otherWorkspace = draft(2, {
      workspaceId: "019d6e7d-0000-7000-8000-000000000003",
    });
    await Promise.all([store.save(first), store.save(otherWorkspace)]);

    await expect(store.load(first)).resolves.toEqual(first);
    await expect(store.load(otherWorkspace)).resolves.toEqual(otherWorkspace);
    await expect(
      store.load({
        eventId: null,
        userId: "019d6e7d-0000-7000-8000-000000000004",
        workspaceId,
      }),
    ).resolves.toBeNull();
  });

  it("replaces one draft atomically and removes only its partition", async () => {
    const storage = new MemoryStorage();
    const store = new EventDraftStore(
      storage,
      () => new Date("2030-01-02T00:00:00.000Z"),
    );
    const first = draft(1);
    const second = draft(2, {
      eventId: "019d6e7d-0000-7000-8000-000000000005",
      commandId: null,
      sourceVersion: 3,
    });
    await store.save(first);
    await store.save(second);
    await store.save({
      ...first,
      fields: { ...first.fields, displayName: "Newest" },
    });
    await store.remove(first);

    await expect(store.load(first)).resolves.toBeNull();
    await expect(store.load(second)).resolves.toEqual(second);
  });

  it("evicts expired, malformed, and oldest entries at the fixed limit", async () => {
    const storage = new MemoryStorage();
    const now = new Date("2030-02-01T00:00:00.000Z");
    const store = new EventDraftStore(storage, () => now);
    const recent = Array.from({ length: maximumEventDrafts + 2 }, (_, index) =>
      draft(index + 1, {
        eventId: `019d6e7d-0000-7000-8001-${String(index + 1).padStart(12, "0")}`,
        commandId: null,
        sourceVersion: 1,
        updatedAt: new Date(now.getTime() - index * 60_000).toISOString(),
      }),
    );
    storage.values.set(eventDraftStorageKey, {
      version: 1,
      drafts: [
        ...recent,
        { ...draft(99), updatedAt: "not-a-date" },
        draft(98, {
          updatedAt: new Date(
            now.getTime() - eventDraftLifetimeMs - 1,
          ).toISOString(),
        }),
      ],
    });

    const newest = recent[0];
    const oldest = recent.at(-1);
    expect(newest).toBeDefined();
    expect(oldest).toBeDefined();
    if (newest === undefined || oldest === undefined) return;
    await expect(store.load(newest)).resolves.toEqual(newest);
    await expect(store.load(oldest)).resolves.toBeNull();
    await store.save(draft(50, { updatedAt: now.toISOString() }));
    const stored = storage.values.get(eventDraftStorageKey) as {
      drafts: unknown[];
    };
    expect(stored.drafts).toHaveLength(maximumEventDrafts);
  });

  it("treats unavailable storage as an empty draft collection", async () => {
    const store = new EventDraftStore(new MemoryStorage());
    await expect(store.load(draft(1))).resolves.toBeNull();
  });
});
