import { describe, expect, it } from "vitest";

import type { TaroStorage } from "../src/auth/session-store";
import {
  maximumTaskDrafts,
  TaskDraftStore,
  taskDraftLifetimeMs,
  taskDraftStorageKey,
  type TaskDraftSnapshot,
} from "../src/tasks/draft-store";
import { emptyTaskFields } from "../src/tasks/editor";

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
const eventId = "019d6e7d-0000-7000-8000-000000000003";

function draft(
  index: number,
  change: Partial<TaskDraftSnapshot> = {},
): TaskDraftSnapshot {
  const baseline = emptyTaskFields("UTC", null, new Date(2030, 0, 1));
  return {
    baseline,
    commandId: `019d6e7d-0000-7000-8000-${String(index).padStart(12, "0")}`,
    eventId,
    fields: { ...baseline, displayName: `Draft ${index}` },
    sourceVersion: null,
    taskId: null,
    updatedAt: new Date(Date.UTC(2030, 0, 1, 0, index)).toISOString(),
    userId,
    workspaceId,
    ...change,
  };
}

describe("Mini Program Task draft store", () => {
  it("partitions drafts by account, workspace, Event, and canonical Task", async () => {
    const storage = new MemoryStorage();
    const store = new TaskDraftStore(
      storage,
      () => new Date("2030-01-02T00:00:00Z"),
    );
    const create = draft(1);
    const edit = draft(2, {
      commandId: null,
      sourceVersion: 4,
      taskId: "019d6e7d-0000-7000-8000-000000000004",
    });
    await Promise.all([store.save(create), store.save(edit)]);

    await expect(store.load(create)).resolves.toEqual(create);
    await expect(store.load(edit)).resolves.toEqual(edit);
    await expect(
      store.load({
        ...create,
        eventId: "019d6e7d-0000-7000-8000-000000000005",
      }),
    ).resolves.toBeNull();
  });

  it("replaces one draft and removes only its identity partition", async () => {
    const storage = new MemoryStorage();
    const store = new TaskDraftStore(
      storage,
      () => new Date("2030-01-02T00:00:00Z"),
    );
    const first = draft(1);
    const second = draft(2, {
      eventId: "019d6e7d-0000-7000-8000-000000000005",
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

  it("evicts expired, malformed, and oldest entries at the shared limit", async () => {
    const storage = new MemoryStorage();
    const now = new Date("2030-02-01T00:00:00.000Z");
    const store = new TaskDraftStore(storage, () => now);
    const recent = Array.from({ length: maximumTaskDrafts + 2 }, (_, index) =>
      draft(index + 1, {
        eventId: `019d6e7d-0000-7000-8001-${String(index + 1).padStart(12, "0")}`,
        updatedAt: new Date(now.getTime() - index * 60_000).toISOString(),
      }),
    );
    storage.values.set(taskDraftStorageKey, {
      drafts: [
        ...recent,
        { ...draft(99), updatedAt: "not-a-date" },
        draft(98, {
          updatedAt: new Date(
            now.getTime() - taskDraftLifetimeMs - 1,
          ).toISOString(),
        }),
      ],
      version: 1,
    });

    const newest = recent[0];
    const oldest = recent.at(-1);
    expect(newest).toBeDefined();
    expect(oldest).toBeDefined();
    if (newest === undefined || oldest === undefined) return;
    await expect(store.load(newest)).resolves.toEqual(newest);
    await expect(store.load(oldest)).resolves.toBeNull();
    await store.save(draft(50, { updatedAt: now.toISOString() }));
    const stored = storage.values.get(taskDraftStorageKey) as {
      drafts: unknown[];
    };
    expect(stored.drafts).toHaveLength(maximumTaskDrafts);
  });

  it("treats unavailable storage as an empty draft collection", async () => {
    await expect(
      new TaskDraftStore(new MemoryStorage()).load(draft(1)),
    ).resolves.toBeNull();
  });
});
