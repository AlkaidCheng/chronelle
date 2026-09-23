import { describe, expect, it } from "vitest";

import type { TaroStorage } from "../src/auth/session-store";
import {
  ReminderDraftStore,
  reminderDraftStorageKey,
  type ReminderDraftSnapshot,
} from "../src/reminders/draft-store";
import { emptyReminderFields } from "../src/reminders/editor";

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
const reminderId = "019d6e7d-0000-7000-8000-000000000004";

function draft(
  change: Partial<ReminderDraftSnapshot> = {},
): ReminderDraftSnapshot {
  const baseline = emptyReminderFields("UTC", new Date("2030-01-01T00:00:00Z"));
  return {
    baseline,
    commandId: reminderId,
    eventId,
    fields: { ...baseline, displayName: "Call the venue" },
    reminderId: null,
    sourceVersion: null,
    updatedAt: "2030-01-01T00:00:00Z",
    userId,
    workspaceId,
    ...change,
  };
}

describe("Mini Program Reminder draft store", () => {
  it("isolates creation and editing drafts by user, workspace and Event", async () => {
    const store = new ReminderDraftStore(
      new MemoryStorage(),
      () => new Date("2030-01-02T00:00:00Z"),
    );
    const create = draft();
    const edit = draft({ commandId: null, reminderId, sourceVersion: 3 });
    await store.save(create);
    await store.save(edit);
    await expect(store.load(create)).resolves.toEqual(create);
    await expect(store.load(edit)).resolves.toEqual(edit);
    await expect(
      store.load({ ...create, userId: reminderId }),
    ).resolves.toBeNull();
    await expect(
      store.load({ ...create, eventId: reminderId }),
    ).resolves.toBeNull();
    await store.remove(create);
    await expect(store.load(edit)).resolves.toEqual(edit);
  });

  it("rejects malformed stored fields", async () => {
    const storage = new MemoryStorage();
    storage.values.set(reminderDraftStorageKey, {
      drafts: [
        draft({ fields: { ...draft().fields, status: "invalid" as never } }),
      ],
      version: 1,
    });
    const store = new ReminderDraftStore(
      storage,
      () => new Date("2030-01-02T00:00:00Z"),
    );
    await expect(store.load(draft())).resolves.toBeNull();
  });
});
