import { beforeEach, describe, expect, it } from "vitest";

import { SandboxStore } from "../sandbox/store";

let store: SandboxStore;

beforeEach(() => {
  let saved: string | null = null;
  store = new SandboxStore({
    getItem: () => saved,
    setItem: (_key, value) => {
      saved = value;
    },
  });
});

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T;
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body;
}

const post = (path: string, body: unknown) =>
  store.fetch(path, { method: "POST", body: JSON.stringify(body) });

describe("sandbox command stack", () => {
  it("executes, undoes, and redoes a content edit as one stack", async () => {
    const tasks = await json<{
      items: { id: string; version: number; displayName: string }[];
    }>(await store.fetch("/api/tasks?filter=all"));
    const task = tasks.items[0];
    if (task === undefined) throw new Error("No sample task.");
    const state = await json<{ version: number; undo: unknown; redo: unknown }>(
      await store.fetch("/api/commands"),
    );
    expect(state).toEqual({ version: 0, undo: null, redo: null });
    const receipt = await json<{ commandId: string; stackVersion: number }>(
      await post("/api/commands", {
        operationId: "019d6e7d-0000-7000-8000-000000000101",
        expectedStackVersion: 0,
        edits: [
          {
            objectType: "task",
            objectId: task.id,
            patch: { expectedVersion: task.version, displayName: "Renamed" },
          },
        ],
      }),
    );
    expect(receipt.stackVersion).toBe(1);
    const renamed = await json<{ displayName: string; version: number }>(
      await store.fetch(`/api/tasks/${task.id}`),
    );
    expect(renamed).toMatchObject({
      displayName: "Renamed",
      version: task.version + 1,
    });
    expect(await json(await store.fetch("/api/commands"))).toEqual({
      version: 1,
      undo: { commandId: receipt.commandId, available: true },
      redo: null,
    });
    await json(
      await post("/api/commands/undo", {
        operationId: "019d6e7d-0000-7000-8000-000000000102",
        commandId: receipt.commandId,
        expectedStackVersion: 1,
      }),
    );
    expect(
      await json<{ displayName: string }>(
        await store.fetch(`/api/tasks/${task.id}`),
      ),
    ).toMatchObject({ displayName: task.displayName });
    expect(await json(await store.fetch("/api/commands"))).toEqual({
      version: 2,
      undo: null,
      redo: { commandId: receipt.commandId, available: true },
    });
    const stale = await post("/api/commands/redo", {
      operationId: "019d6e7d-0000-7000-8000-000000000103",
      commandId: receipt.commandId,
      expectedStackVersion: 1,
    });
    expect(stale.status).toBe(409);
    await json(
      await post("/api/commands/redo", {
        operationId: "019d6e7d-0000-7000-8000-000000000104",
        commandId: receipt.commandId,
        expectedStackVersion: 2,
      }),
    );
    expect(
      await json<{ displayName: string }>(
        await store.fetch(`/api/tasks/${task.id}`),
      ),
    ).toMatchObject({ displayName: "Renamed" });
  });
});
