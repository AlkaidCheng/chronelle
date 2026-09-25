import { ApiClientError } from "@livtales/api-client";
import { describe, expect, it, vi } from "vitest";
import {
  EditorDraftStore,
  readEventFields,
  type EventDraftSnapshot,
  type TaskDraftSnapshot,
  type ExpenseDraftSnapshot,
  eventCreationDraftKeys,
} from "../lib/editor-draft-store";
import { readTaskFields } from "../lib/task-fields";
import { readExpenseFields } from "../lib/expense-fields";

function snapshot(displayName = "Garden evening"): EventDraftSnapshot {
  const baseline = readEventFields();
  return {
    kind: "event",
    source: undefined,
    baseline,
    fields: { ...baseline, displayName },
  };
}

function setup() {
  const controller = new AbortController();
  return { controller, store: new EditorDraftStore(controller.signal) };
}

function taskSnapshot(displayName = "Pack supplies"): TaskDraftSnapshot {
  const baseline = readTaskFields();
  return {
    kind: "task",
    source: undefined,
    baseline,
    fields: { ...baseline, displayName },
  };
}

function expenseSnapshot(): ExpenseDraftSnapshot {
  const baseline = readExpenseFields();
  return {
    kind: "expense",
    source: undefined,
    baseline,
    fields: { ...baseline, displayName: "Deposit", amount: "-0.0001" },
  };
}

const snapshots = [snapshot(), taskSnapshot(), expenseSnapshot()] as const;

describe("editor draft retention", () => {
  it("separates parent creation keys from canonical edits and other parents", () => {
    const { store } = setup();
    const first = eventCreationDraftKeys("first-event");
    const second = eventCreationDraftKeys("second-event");
    const attempt = {
      current: { key: "first-attempt", commandId: "command-id" },
    };
    const draft = { ...taskSnapshot(), creationAttempt: attempt };
    store.keep(first.task, draft);
    store.keep(first.schedule, snapshot());
    store.keep(first.expense, expenseSnapshot());
    store.keep("canonical-expense", expenseSnapshot());
    store.keep(second.task, taskSnapshot("Another plan"));
    store.keep("canonical-task", taskSnapshot("Edit task"));
    for (const id of Object.values(first)) store.forget(id);
    expect(store.get(first.task)).toBeUndefined();
    expect(store.get(first.schedule)).toBeUndefined();
    expect(store.get(first.expense)).toBeUndefined();
    expect(store.get("canonical-expense")?.snapshot.kind).toBe("expense");
    expect(store.get(second.task)?.snapshot.fields.displayName).toBe(
      "Another plan",
    );
    expect(store.get("canonical-task")?.snapshot.fields.displayName).toBe(
      "Edit task",
    );
    store.keep(first.task, draft);
    expect(store.get(first.task)?.snapshot.creationAttempt).toBe(attempt);
  });
  it("keeps stable snapshots and notifies only when an entry changes", () => {
    const { store } = setup();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const draft = snapshot();
    expect(store.hasDrafts).toBe(false);
    expect(store.keep("new", draft)).toBe(true);
    const entry = store.get("new");
    expect(entry?.snapshot).toBe(draft);
    store.keep("new", draft);
    expect(store.get("new")).toBe(entry);
    expect(listener).toHaveBeenCalledOnce();
    store.forget("missing");
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    store.forget("new");
    expect(store.hasDrafts).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("evicts the least recently changed settled draft at the twenty-draft limit", () => {
    const { store } = setup();
    for (let index = 0; index < 20; index++)
      store.keep(
        `${index}`,
        snapshots[index % snapshots.length] ?? snapshots[0],
      );
    store.keep("0", snapshot("Updated"));
    store.keep("new", snapshot());
    expect(store.get("1")).toBeUndefined();
    expect(store.get("0")?.snapshot.fields.displayName).toBe("Updated");
    expect(store.get("new")).toBeDefined();
  });

  it("reserves pending typed entries until a save settles", async () => {
    const { store } = setup();
    const completion = Promise.withResolvers<void>();
    const saves: Promise<void>[] = [];
    for (let index = 0; index < 20; index++) {
      const id = `${index}`;
      store.keep(id, snapshots[index % snapshots.length] ?? snapshots[0]);
      saves.push(store.save(id, () => completion.promise));
    }
    expect(store.canKeep("new")).toBe(false);
    expect(store.keep("new", snapshot())).toBe(false);
    expect(store.canKeep("0")).toBe(true);
    expect(store.get("0")?.pending).toBe(true);
    completion.resolve();
    await Promise.all(saves);
    expect(store.canKeep("new")).toBe(true);
    expect(store.hasDrafts).toBe(false);
  });

  it("never evicts a pending save when settled drafts are available", async () => {
    const { store } = setup();
    store.keep("pending", snapshot());
    const completion = Promise.withResolvers<void>();
    const saving = store.save("pending", () => completion.promise);
    for (let index = 0; index < 20; index++) store.keep(`${index}`, snapshot());
    expect(store.get("pending")?.pending).toBe(true);
    expect(store.get("0")).toBeUndefined();
    completion.resolve();
    await saving;
  });

  it("allows only one pending operation and clears its draft after success", async () => {
    const { store } = setup();
    const draft = snapshot();
    store.keep("new", draft);
    const completion = Promise.withResolvers<string>();
    const saving = store.save("new", () => completion.promise);
    const duplicate = vi.fn();
    await expect(store.save("new", duplicate)).rejects.toThrow("pending saves");
    expect(duplicate).not.toHaveBeenCalled();
    store.keep("new", snapshot("Changed during save"));
    expect(store.get("new")?.snapshot).toBe(draft);
    completion.resolve("canonical-id");
    await expect(saving).resolves.toBe("canonical-id");
    expect(store.get("new")).toBeUndefined();
  });

  it.each([409, 429, 500, 0])(
    "retains failed saves for explicit recovery (%s)",
    async (status) => {
      const { store } = setup();
      const draft = snapshot();
      store.keep("event", draft);
      const error = new ApiClientError(status, "save_failed", "Could not save");
      await expect(
        store.save("event", () => Promise.reject(error)),
      ).rejects.toBe(error);
      expect(store.get("event")).toEqual({
        snapshot: draft,
        pending: false,
        failed: true,
      });
      await store.save("event", () => Promise.resolve("saved"));
      expect(store.get("event")).toBeUndefined();
    },
  );

  it.each([401, 403, 404])(
    "forgets a draft after definitive access loss (%s)",
    async (status) => {
      const { store } = setup();
      store.keep("event", snapshot());
      await expect(
        store.save("event", () =>
          Promise.reject(
            new ApiClientError(status, "forbidden", "Unavailable"),
          ),
        ),
      ).rejects.toBeInstanceOf(ApiClientError);
      expect(store.hasDrafts).toBe(false);
    },
  );

  it.each(["resolve", "reject"] as const)(
    "cannot change a replacement draft after an earlier save %ss",
    async (outcome) => {
      const { store } = setup();
      store.keep("event", snapshot());
      const completion = Promise.withResolvers<void>();
      const saving = store
        .save("event", () => completion.promise)
        .catch(() => {});
      store.forget("event");
      const replacement = snapshot("Replacement");
      store.keep("event", replacement);
      if (outcome === "resolve") completion.resolve();
      else completion.reject(new Error("Disconnected"));
      await saving;
      expect(store.get("event")).toEqual({
        snapshot: replacement,
        pending: false,
        failed: false,
      });
    },
  );

  it("blocks reads, writes and late results after session abort", async () => {
    const { controller, store } = setup();
    store.keep("event", snapshot());
    const completion = Promise.withResolvers<void>();
    const saving = store.save("event", () => completion.promise);
    controller.abort();
    expect(store.get("event")).toBeUndefined();
    expect(store.canKeep("new")).toBe(false);
    expect(store.keep("new", snapshot())).toBe(false);
    expect(store.hasDrafts).toBe(false);
    store.clear();
    completion.resolve();
    await saving;
    expect(store.get("event")).toBeUndefined();
  });
});
