import { LivTalesApiClient } from "@livtales/api-client";
import { eventComponentKindSchema } from "@livtales/schemas";
import { describe, expect, it } from "vitest";
import {
  SandboxStore,
  sandboxStorageKey,
  sandboxWorkspaceId,
} from "../sandbox/store";

function storage(initial: string | null = null) {
  let raw = initial;
  return {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
  };
}
async function request(
  store: SandboxStore,
  path: string,
  method = "GET",
  body?: unknown,
  role: "owner" | "viewer" = "owner",
) {
  return store.fetch(
    `/api/${path}`,
    { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    role,
  );
}

describe("browser sandbox", () => {
  it("paginates bounded search results without duplicating canonical records", async () => {
    const store = new SandboxStore(storage());
    for (let index = 0; index < 10; index++)
      await request(store, "events", "POST", {
        displayName: `Searchable ${index}`,
      });
    const first = await (
      await request(store, "search?query=Searchable&limit=8")
    ).json();
    expect(first.items).toHaveLength(8);
    expect(first.nextCursor).toBe(first.items[7].id);
    const second = await (
      await request(
        store,
        `search?query=Searchable&limit=8&cursor=${first.nextCursor}`,
      )
    ).json();
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(10);
    expect(
      (await request(store, "search?query=Searchable&cursor=unknown")).status,
    ).toBe(400);
  });

  it("reads current-only snapshots and preserves a full layout store on failed writes", async () => {
    const saved = storage();
    const store = new SandboxStore(saved);
    const event = await (
      await request(store, "events", "POST", { displayName: "Snapshot" })
    ).json();
    const layout = {
      eventId: event.id,
      version: 7,
      pages: [],
      updatedAt: new Date().toISOString(),
    };
    const snapshot = JSON.parse(saved.getItem() ?? "null");
    const currentOnly = storage(
      JSON.stringify({ ...snapshot, layouts: [layout] }),
    );
    const reloaded = new SandboxStore(currentOnly);
    expect(
      await (await request(reloaded, `events/${event.id}/layout`)).json(),
    ).toEqual(layout);
    expect(
      (
        await request(reloaded, `events/${event.id}/layout/restore`, "POST", {
          expectedVersion: 7,
          targetVersion: 1,
        })
      ).status,
    ).toBe(404);
    const full = storage(
      JSON.stringify({
        ...snapshot,
        layouts: Array.from({ length: 2000 }, (_, index) => ({
          ...layout,
          version: index + 1,
        })),
      }),
    );
    const fullStore = new SandboxStore(full);
    const before = full.getItem();
    expect(
      (
        await request(fullStore, `events/${event.id}/layout/restore`, "POST", {
          expectedVersion: 2000,
          targetVersion: 1,
        })
      ).status,
    ).toBe(400);
    expect(full.getItem()).toBe(before);
    expect(
      await (await request(fullStore, `events/${event.id}/layout`)).json(),
    ).toMatchObject({ version: 2000 });
  });

  it("retains paginated layout history, restores snapshots, and enforces viewer access", async () => {
    const saved = storage();
    const store = new SandboxStore(saved);
    const client = new LivTalesApiClient({
      getCredential: () => ({
        accessToken: "sample",
        workspaceId: sandboxWorkspaceId,
      }),
      fetch: (input, options) => store.fetch(input, options),
    });
    const event = await client.createEvent({ displayName: "Layout history" });
    const pages = [
      {
        id: crypto.randomUUID(),
        name: "Plan",
        components: [{ id: crypto.randomUUID(), kind: "todos" as const }],
      },
    ];
    await client.updateEventLayout(event.id, { expectedVersion: 0, pages });
    await client.updateEventLayout(event.id, { expectedVersion: 1, pages: [] });
    const restored = await client.restoreEventLayout(event.id, {
      expectedVersion: 2,
      targetVersion: 1,
    });
    expect(restored).toMatchObject({ version: 3, pages });
    const history = await client.getEventLayoutHistory(event.id, { limit: 2 });
    expect(history.items.map((item) => item.version)).toEqual([3, 2]);
    expect(history.nextBeforeVersion).toBe(2);
    expect(
      (
        await client.getEventLayoutHistory(event.id, { beforeVersion: 2 })
      ).items.map((item) => item.version),
    ).toEqual([1]);
    await expect(
      client.restoreEventLayout(event.id, {
        expectedVersion: 2,
        targetVersion: 0,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      client.restoreEventLayout(event.id, {
        expectedVersion: 3,
        targetVersion: 99,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (
        await request(
          store,
          `events/${event.id}/layout/history`,
          "GET",
          undefined,
          "viewer",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          store,
          `events/${event.id}/layout/restore`,
          "POST",
          { expectedVersion: 3, targetVersion: 0 },
          "viewer",
        )
      ).status,
    ).toBe(403);
    expect(await client.getEvent(event.id)).toEqual(event);
    const reloaded = new SandboxStore(saved);
    expect(
      await (
        await request(reloaded, `events/${event.id}/layout/history`)
      ).json(),
    ).toMatchObject({
      items: [{ version: 3 }, { version: 2 }, { version: 1 }],
    });
    expect(
      await client.restoreEventLayout(event.id, {
        expectedVersion: 3,
        targetVersion: 0,
      }),
    ).toMatchObject({ version: 4, pages: [] });
  });

  it("persists independent page layouts, preserves them through task creation, and rejects stale saves", async () => {
    const saved = storage();
    const store = new SandboxStore(saved);
    const getCredential = () => ({
      accessToken: "sample",
      workspaceId: sandboxWorkspaceId,
    });
    const client = new LivTalesApiClient({
      getCredential,
      fetch: (input, options) => store.fetch(input, options),
    });
    const event = await client.createEvent({ displayName: "Summer vacation" });
    const pages = [
      {
        id: crypto.randomUUID(),
        name: "Preparation",
        components: eventComponentKindSchema.options.map((kind) => ({
          id: crypto.randomUUID(),
          kind,
        })),
      },
    ];
    const layout = await client.updateEventLayout(event.id, {
      expectedVersion: 0,
      pages,
    });
    await client.createEventResource(event.id, {
      commandId: crypto.randomUUID(),
      resource: { objectType: "task", displayName: "Pack" },
    });
    expect(await client.getEventLayout(event.id)).toEqual(layout);
    expect(await client.getEvent(event.id)).toEqual(event);
    await expect(
      client.updateEventLayout(event.id, { expectedVersion: 0, pages: [] }),
    ).rejects.toMatchObject({ status: 409 });
    const reloaded = new LivTalesApiClient({
      getCredential,
      fetch: (input, options) => new SandboxStore(saved).fetch(input, options),
    });
    expect(await reloaded.getEventLayout(event.id)).toEqual(layout);
    const viewer = await store.fetch(
      `/api/events/${event.id}/layout`,
      {
        method: "PATCH",
        body: JSON.stringify({ expectedVersion: 1, pages: [] }),
      },
      "viewer",
    );
    expect(viewer.status).toBe(403);
    expect(await reloaded.getEventLayout(event.id)).toEqual(layout);
  });

  it("creates typed planning resources through the production client contract", async () => {
    const store = new SandboxStore(storage());
    const client = new LivTalesApiClient({
      getCredential: () => ({
        accessToken: "sample",
        workspaceId: sandboxWorkspaceId,
      }),
      fetch: (input, options) => store.fetch(input, options),
    });
    const event = await client.createEvent({ displayName: "Review" });
    const created = await client.createEventResource(event.id, {
      commandId: crypto.randomUUID(),
      resource: { objectType: "task", displayName: "Invite guests" },
    });
    expect((await client.getEventTodos(event.id)).items).toEqual([
      created.resource,
    ]);
    const date = new Date().toISOString();
    const expense = await client.createEventResource(event.id, {
      commandId: crypto.randomUUID(),
      resource: {
        objectType: "expense",
        displayName: "Deposit",
        amount: "12.0000",
        currency: "USD",
        occurredAt: date,
      },
    });
    expect(await client.getExpense(expense.resource.id)).toEqual(
      expense.resource,
    );
    await expect(client.getExpense(created.resource.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(client.getTask(expense.resource.id)).rejects.toMatchObject({
      status: 404,
    });
    const reminder = await client.createEventResource(event.id, {
      commandId: crypto.randomUUID(),
      resource: {
        objectType: "reminder",
        displayName: "Weather",
        remindAt: date,
      },
    });
    expect(await client.getReminder(reminder.resource.id)).toEqual(
      reminder.resource,
    );
    await expect(client.getReminder(expense.resource.id)).rejects.toMatchObject(
      {
        status: 404,
      },
    );
    await expect(client.getExpense(reminder.resource.id)).rejects.toMatchObject(
      {
        status: 404,
      },
    );
    expect((await client.getEventExpenses(event.id)).items).toHaveLength(1);
    expect((await client.getEventReminders(event.id)).items).toHaveLength(1);
    expect((await client.getEventTimeline(event.id)).items).toHaveLength(2);
  });
  it("replays a standalone creation by command id and refuses a changed input", async () => {
    const store = new SandboxStore(storage());
    const client = new LivTalesApiClient({
      getCredential: () => ({
        accessToken: "sample",
        workspaceId: sandboxWorkspaceId,
      }),
      fetch: (input, options) => store.fetch(input, options),
    });
    const commandId = crypto.randomUUID();
    const task = await client.createTask({ displayName: "Once", commandId });
    const again = await client.createTask({ displayName: "Once", commandId });
    expect(again.id).toBe(task.id);
    expect(
      (await client.listTasks()).items.filter(({ id }) => id === task.id),
    ).toHaveLength(1);
    await expect(
      client.createTask({ displayName: "Twice", commandId }),
    ).rejects.toMatchObject({ status: 409 });
    const personCommand = crypto.randomUUID();
    const person = await client.createPerson({
      displayName: "Mira",
      commandId: personCommand,
    });
    expect(
      (
        await client.createPerson({
          displayName: "Mira",
          commandId: personCommand,
        })
      ).id,
    ).toBe(person.id);
  });
  it("lists the tasks due in a range of days named in a time zone", async () => {
    const store = new SandboxStore(storage());
    const client = new LivTalesApiClient({
      getCredential: () => ({
        accessToken: "sample",
        workspaceId: sandboxWorkspaceId,
      }),
      fetch: (input, options) => store.fetch(input, options),
    });
    const dated = await client.createTask({
      displayName: "Book the room",
      dueOn: "2030-03-05",
    });
    // 09:30Z on March 5 is still March 4 in Honolulu.
    const timed = await client.createTask({
      displayName: "Confirm the caterer",
      dueAt: "2030-03-05T09:30:00Z",
    });
    await client.createTask({ displayName: "Read the contract" });
    const ids = async (input: Parameters<typeof client.listTasks>[0]) =>
      (await client.listTasks(input)).items.map(({ id }) => id);
    expect(await ids({ dueFrom: "2030-03-05", dueTo: "2030-03-05" })).toEqual([
      dated.id,
      timed.id,
    ]);
    expect(
      await ids({
        dueFrom: "2030-03-05",
        dueTo: "2030-03-05",
        timezone: "Pacific/Honolulu",
      }),
    ).toEqual([dated.id]);
    expect(
      await ids({
        dueFrom: "2030-03-04",
        dueTo: "2030-03-04",
        timezone: "Pacific/Honolulu",
      }),
    ).toEqual([timed.id]);
    expect(await ids({ dueFrom: "2030-03-06" })).toEqual([]);
    await expect(
      client.listTasks({ dueFrom: "2030-03-06", dueTo: "2030-03-05" }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("keeps a task's duration with its due time and refuses one without", async () => {
    const store = new SandboxStore(storage());
    const client = new LivTalesApiClient({
      getCredential: () => ({
        accessToken: "sample",
        workspaceId: sandboxWorkspaceId,
      }),
      fetch: (input, options) => store.fetch(input, options),
    });
    const timed = await client.createTask({
      displayName: "Walk the venue",
      dueAt: "2030-03-05T09:30:00Z",
      durationMinutes: 45,
    });
    expect(timed.durationMinutes).toBe(45);
    expect((await client.getTask(timed.id)).durationMinutes).toBe(45);
    const cleared = await client.updateTask(timed.id, {
      expectedVersion: 1,
      dueAt: null,
      durationMinutes: null,
    });
    expect(cleared.durationMinutes).toBeNull();
    await expect(
      client.createTask({ displayName: "Untimed", durationMinutes: 30 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      client.updateTask(timed.id, {
        expectedVersion: 2,
        durationMinutes: 1441,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("advances a repeating task's due on completion, as the API does", async () => {
    const store = new SandboxStore(storage());
    const client = new LivTalesApiClient({
      getCredential: () => ({
        accessToken: "sample",
        workspaceId: sandboxWorkspaceId,
      }),
      fetch: (input, options) => store.fetch(input, options),
    });
    const weekly = await client.createTask({
      displayName: "Water the plants",
      dueOn: "2030-03-05",
      repeatRule: "weekly",
      repeatUntil: "2030-03-12",
    });
    expect(weekly).toMatchObject({
      repeatRule: "weekly",
      repeatUntil: "2030-03-12",
    });
    const advanced = await client.updateTask(weekly.id, {
      expectedVersion: 1,
      status: "done",
      completedAt: "2030-03-05T18:00:00Z",
    });
    expect(advanced).toMatchObject({
      status: "todo",
      dueOn: "2030-03-12",
      completedAt: null,
      version: 2,
    });
    const last = await client.updateTask(weekly.id, {
      expectedVersion: 2,
      status: "done",
      completedAt: "2030-03-12T18:00:00Z",
    });
    expect(last).toMatchObject({ status: "done", dueOn: "2030-03-12" });
    const monthly = await client.createTask({
      displayName: "Rent",
      dueAt: "2030-01-31T09:00:00Z",
      repeatRule: "monthly",
    });
    const february = await client.updateTask(monthly.id, {
      expectedVersion: 1,
      status: "done",
      completedAt: "2030-01-31T10:00:00Z",
    });
    expect(february).toMatchObject({
      status: "todo",
      dueAt: "2030-02-28T09:00:00.000Z",
    });
    const cleared = await client.updateTask(monthly.id, {
      expectedVersion: 2,
      repeatRule: null,
    });
    expect(cleared).toMatchObject({ repeatRule: null, repeatUntil: null });
    await expect(
      client.createTask({ displayName: "Undated", repeatRule: "daily" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      client.createTask({
        displayName: "Backwards",
        dueOn: "2030-03-05",
        repeatRule: "daily",
        repeatUntil: "2030-03-04",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("ranks new tasks last and lists them in manual order", async () => {
    const store = new SandboxStore(storage());
    const client = new LivTalesApiClient({
      getCredential: () => ({
        accessToken: "sample",
        workspaceId: sandboxWorkspaceId,
      }),
      fetch: (input, options) => store.fetch(input, options),
    });
    const first = await client.createTask({ displayName: "Ranked first" });
    const second = await client.createTask({ displayName: "Ranked second" });
    expect(second.rank > first.rank).toBe(true);
    const moved = await client.updateTask(second.id, {
      expectedVersion: 1,
      rank: "00000000500",
    });
    expect(moved.rank).toBe("00000000500");
    const page = await client.listTasks({ sort: "manual", limit: 50 });
    const names = page.items.map((task) => task.displayName);
    expect(names.indexOf("Ranked second")).toBeLessThan(
      names.indexOf("Ranked first"),
    );
    await expect(
      client.updateTask(first.id, { expectedVersion: 1, rank: "500" }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("keeps people in name order and links one person to the signed-in account", async () => {
    const store = new SandboxStore(storage());
    const client = new LivTalesApiClient({
      getCredential: () => ({
        accessToken: "sample",
        workspaceId: sandboxWorkspaceId,
      }),
      fetch: (input, options) => store.fetch(input, options),
    });
    const zoe = await client.createPerson({ displayName: "Zoe" });
    const adam = await client.createPerson({
      displayName: "adam",
      contacts: [{ kind: "email", value: "adam@example.test" }],
    });
    expect(zoe).toMatchObject({
      objectType: "person",
      contacts: [],
      userId: null,
      version: 1,
    });
    expect((await client.listPersons()).items.map(({ id }) => id)).toEqual([
      adam.id,
      zoe.id,
    ]);
    expect(
      (await client.listPersons({ query: "zo" })).items.map(({ id }) => id),
    ).toEqual([zoe.id]);
    expect(await client.getPerson(adam.id)).toEqual(adam);
    const me = (await client.getSession()).user.id;
    const linked = await client.updatePerson(zoe.id, {
      expectedVersion: 1,
      userId: me,
    });
    expect(linked.userId).toBe(me);
    await expect(
      client.updatePerson(adam.id, { expectedVersion: 1, userId: me }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      client.createPerson({ displayName: "x", userId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(client.getTask(zoe.id)).rejects.toMatchObject({ status: 404 });
  });
  it("edits a canonical event once across calendar and itinerary, and persists it", async () => {
    const saved = storage();
    const store = new SandboxStore(saved);
    const { items } = await (await request(store, "events")).json();
    const parent = items.find(
      (item: { displayName: string }) =>
        item.displayName === "Autumn gathering",
    );
    const calendar = await (
      await request(store, `events/${parent.id}/calendar`)
    ).json();
    const child = calendar.items[0];
    const response = await request(store, `events/${child.id}`, "PATCH", {
      expectedVersion: child.version,
      displayName: "Opening session",
    });
    expect(response.status).toBe(200);
    for (const view of ["calendar", "itinerary"]) {
      const projection = await (
        await request(new SandboxStore(saved), `events/${parent.id}/${view}`)
      ).json();
      expect(projection.items[0]).toMatchObject({
        id: child.id,
        displayName: "Opening session",
        version: 2,
      });
    }
    expect(
      (
        await request(store, `events/${child.id}`, "PATCH", {
          expectedVersion: 1,
          displayName: "Stale",
        })
      ).status,
    ).toBe(409);
  });
  it("does not silently overwrite unreadable snapshots or failed storage writes", async () => {
    const saved = storage("broken");
    const store = new SandboxStore(saved);
    expect(store.notice).toContain("unreadable");
    expect(
      (await request(store, "events", "POST", { displayName: "Test" })).status,
    ).toBe(409);
    expect(saved.getItem()).toBe("broken");
    store.reset();
    expect(store.notice).not.toContain("unreadable");
    const blocked = new SandboxStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("Quota");
      },
    });
    const before = await (await request(blocked, "events")).json();
    expect(
      (await request(blocked, "events", "POST", { displayName: "Unsaved" }))
        .status,
    ).toBe(400);
    const after = await (await request(blocked, "events")).json();
    expect(after.items).toEqual(before.items);
  });
  it("rejects stale browser snapshots, Viewer writes, other workspaces and external requests", async () => {
    const saved = storage();
    const first = new SandboxStore(saved);
    const second = new SandboxStore(saved);
    expect(
      (await request(first, "events", "POST", { displayName: "First" })).status,
    ).toBe(200);
    expect(
      (await request(second, "events", "POST", { displayName: "Second" }))
        .status,
    ).toBe(409);
    expect(
      (
        await request(
          first,
          "events",
          "POST",
          { displayName: "Viewer" },
          "viewer",
        )
      ).status,
    ).toBe(403);
    expect((await first.fetch("https://example.test/api/events")).status).toBe(
      403,
    );
    expect(
      (
        await first.fetch("/api/events", {
          headers: { "x-workspace-id": "other" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await first.fetch("/api/events", {
          headers: { "x-workspace-id": sandboxWorkspaceId },
        })
      ).status,
    ).toBe(200);
    expect(
      (await request(first, "documents/upload-url", "POST", {})).status,
    ).toBe(501);
    expect(sandboxStorageKey).toBe("chronelle.design-sandbox.v1");
  });
});
