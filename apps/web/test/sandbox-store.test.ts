import { describe, expect, it } from "vitest";
import { ChronelleApiClient } from "@chronelle/api-client";
import { eventComponentKindSchema } from "@chronelle/schemas";
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
  it("persists independent page layouts, preserves them through task creation, and rejects stale saves", async () => {
    const saved = storage();
    const store = new SandboxStore(saved);
    const getCredential = () => ({
      accessToken: "sample",
      workspaceId: sandboxWorkspaceId,
    });
    const client = new ChronelleApiClient({
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
    const reloaded = new ChronelleApiClient({
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
    const client = new ChronelleApiClient({
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
    await client.createEventResource(event.id, {
      commandId: crypto.randomUUID(),
      resource: {
        objectType: "expense",
        displayName: "Deposit",
        amount: "12.0000",
        currency: "USD",
        occurredAt: date,
      },
    });
    await client.createEventResource(event.id, {
      commandId: crypto.randomUUID(),
      resource: {
        objectType: "reminder",
        displayName: "Weather",
        remindAt: date,
      },
    });
    expect((await client.getEventExpenses(event.id)).items).toHaveLength(1);
    expect((await client.getEventReminders(event.id)).items).toHaveLength(1);
    expect((await client.getEventTimeline(event.id)).items).toHaveLength(2);
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
