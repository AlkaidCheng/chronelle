// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EventResponse } from "@chronelle/schemas";

import { Providers } from "../app/providers";
import { EventWorkspace } from "../features/events/event-workspace";

const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const userId = "019d6e7d-0000-7000-8000-000000000002";
const eventId = "019d6e7d-0000-7000-8000-000000000010";
const scheduledEventId = "019d6e7d-0000-7000-8000-000000000011";

const rootEvent = {
  id: eventId,
  workspaceId,
  objectType: "event",
  displayName: "Launch night",
  createdBy: userId,
  permissionScopeId: eventId,
  createdAt: "2026-09-02T20:00:00.000Z",
  updatedAt: "2026-09-02T20:00:00.000Z",
  version: 1,
  archivedAt: null,
  deletedAt: null,
  customProperties: {},
  metadata: {},
  startsAt: "2026-10-15T16:00:00.000Z",
  endsAt: "2026-10-16T03:00:00.000Z",
  timezone: "America/Los_Angeles",
  isAllDay: false,
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function requestPath(input: URL | RequestInfo): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.pathname : new URL(input.url).pathname;
}

describe("EventWorkspace", () => {
  beforeEach(() => {
    window.sessionStorage.setItem(
      "chronelle.development-session",
      JSON.stringify({ accessToken: "test-session", workspaceId }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("creates one scheduled Event and shows its identity in every projection", async () => {
    let scheduledEvent: EventResponse | null = null;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const path = requestPath(input);
      if (path === `/api/events/${eventId}/detail`) {
        return jsonResponse({
          event: rootEvent,
          events: scheduledEvent === null ? [] : [scheduledEvent],
          tasks: [],
          expenses: [],
          reminders: [],
          documents: [],
          lockedRelationCount: 0,
        });
      }
      if (path === `/api/objects/${eventId}/access`) {
        return jsonResponse({
          resourceId: eventId,
          actions: ["view", "comment", "edit", "share", "delete"],
        });
      }
      if (path === `/api/events/${eventId}/todos`) {
        return jsonResponse({ sourceEventId: eventId, items: [] });
      }
      if (
        path === `/api/events/${eventId}/calendar` ||
        path === `/api/events/${eventId}/itinerary`
      ) {
        return jsonResponse({
          sourceEventId: eventId,
          items: scheduledEvent === null ? [] : [scheduledEvent],
        });
      }
      if (path === `/api/events/${eventId}/timeline`) {
        return jsonResponse({
          sourceEventId: eventId,
          items:
            scheduledEvent === null
              ? []
              : [
                  {
                    canonicalObjectId: scheduledEvent.id,
                    objectType: "event",
                    displayName: scheduledEvent.displayName,
                    occursAt: scheduledEvent.startsAt,
                    version: scheduledEvent.version,
                  },
                ],
        });
      }
      if (
        path === `/api/events/${eventId}/expenses` ||
        path === `/api/events/${eventId}/reminders`
      ) {
        return jsonResponse({ sourceEventId: eventId, items: [] });
      }
      if (path === "/api/events" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          displayName: string;
          startsAt: string;
        };
        scheduledEvent = {
          ...rootEvent,
          id: scheduledEventId,
          displayName: body.displayName,
          permissionScopeId: eventId,
          startsAt: body.startsAt,
          endsAt: null,
        };
        return jsonResponse(scheduledEvent, 201);
      }
      if (path === `/api/objects/${eventId}/relations`) {
        return jsonResponse(
          {
            id: "019d6e7d-0000-7000-8000-000000000012",
            workspaceId,
            sourceObjectId: eventId,
            relationType: "includes",
            targetObjectId: scheduledEventId,
            metadata: {},
            createdBy: userId,
            createdAt: "2026-09-02T20:01:00.000Z",
            deletedAt: null,
          },
          201,
        );
      }
      return jsonResponse(
        { error: { code: "not_found", message: `No mock for ${path}` } },
        404,
      );
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();

    render(
      <Providers>
        <EventWorkspace eventId={eventId} />
      </Providers>,
    );

    expect(
      await screen.findByRole("heading", { name: "Launch night" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Calendar" }));
    await user.click(screen.getByRole("button", { name: "Add schedule item" }));
    await user.type(screen.getByLabelText("Schedule item"), "Guest arrival");
    fireEvent.change(screen.getByLabelText("Starts"), {
      target: { value: "2026-10-15T17:30" },
    });
    await user.click(screen.getByRole("button", { name: "Add to schedule" }));

    expect(
      await screen.findByRole("heading", { name: "Guest arrival" }),
    ).toBeVisible();
    expect(screen.getByText("ID 00000011")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Itinerary" }));
    expect(
      screen.getByRole("heading", { name: "Guest arrival" }),
    ).toBeVisible();
    expect(screen.getByText("ID 00000011")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Timeline" }));
    expect(
      screen.getByRole("heading", { name: "Guest arrival" }),
    ).toBeVisible();
    expect(screen.getByText("ID 00000011")).toBeVisible();
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/events",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("renders a shared Event as read-only without leaking private relations", async () => {
    const task = {
      ...rootEvent,
      id: "019d6e7d-0000-7000-8000-000000000013",
      objectType: "task",
      displayName: "Confirm guest list",
      permissionScopeId: eventId,
      startsAt: undefined,
      endsAt: undefined,
      timezone: undefined,
      isAllDay: undefined,
      status: "todo",
      dueAt: "2026-10-10T18:00:00.000Z",
      completedAt: null,
    } as const;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const path = requestPath(input);
      if (path === `/api/events/${eventId}/detail`) {
        return jsonResponse({
          event: rootEvent,
          events: [],
          tasks: [task],
          expenses: [],
          reminders: [],
          documents: [],
          lockedRelationCount: 1,
        });
      }
      if (path === `/api/objects/${eventId}/access`) {
        return jsonResponse({ resourceId: eventId, actions: ["view"] });
      }
      if (path === `/api/events/${eventId}/todos`) {
        return jsonResponse({ sourceEventId: eventId, items: [task] });
      }
      if (
        path === `/api/events/${eventId}/calendar` ||
        path === `/api/events/${eventId}/itinerary` ||
        path === `/api/events/${eventId}/expenses` ||
        path === `/api/events/${eventId}/reminders`
      ) {
        return jsonResponse({ sourceEventId: eventId, items: [] });
      }
      if (path === `/api/events/${eventId}/timeline`) {
        return jsonResponse({
          sourceEventId: eventId,
          items: [
            {
              canonicalObjectId: task.id,
              objectType: "task",
              displayName: task.displayName,
              occursAt: task.dueAt,
              version: task.version,
            },
          ],
        });
      }
      return jsonResponse(
        { error: { code: "not_found", message: `No mock for ${path}` } },
        404,
      );
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();

    render(
      <Providers>
        <EventWorkspace eventId={eventId} />
      </Providers>,
    );

    expect(await screen.findByText("Viewer access")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Edit event" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sharing" })).toBeNull();
    expect(screen.getByText("Private related items")).toBeVisible();
    expect(
      screen.getByText("1 related item is outside your permission scope."),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "To-dos" }));
    expect(screen.getByText("Confirm guest list")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Complete Confirm guest list" }),
    ).toBeDisabled();
    expect(screen.queryByLabelText("Task")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Calendar" }));
    expect(
      screen.queryByRole("button", { name: "Add schedule item" }),
    ).toBeNull();
  });

  it("shares an Event with an existing development user", async () => {
    const grantId = "019d6e7d-0000-7000-8000-000000000020";
    const collaboratorId = "019d6e7d-0000-7000-8000-000000000021";
    let shares: unknown[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const path = requestPath(input);
      if (path === `/api/events/${eventId}/detail`) {
        return jsonResponse({
          event: rootEvent,
          events: [],
          tasks: [],
          expenses: [],
          reminders: [],
          documents: [],
          lockedRelationCount: 0,
        });
      }
      if (path === `/api/objects/${eventId}/access`) {
        return jsonResponse({
          resourceId: eventId,
          actions: ["view", "comment", "edit", "share", "delete"],
        });
      }
      if (
        path === `/api/events/${eventId}/todos` ||
        path === `/api/events/${eventId}/calendar` ||
        path === `/api/events/${eventId}/itinerary` ||
        path === `/api/events/${eventId}/expenses` ||
        path === `/api/events/${eventId}/reminders` ||
        path === `/api/events/${eventId}/timeline`
      ) {
        return jsonResponse({ sourceEventId: eventId, items: [] });
      }
      if (path === `/api/objects/${eventId}/shares`) {
        return jsonResponse({ items: shares });
      }
      if (path === "/api/shares" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          principalEmail: string;
          resourceId: string;
          role: string;
        };
        const grant = {
          id: grantId,
          workspaceId,
          resourceId: body.resourceId,
          principal: {
            id: collaboratorId,
            displayName: "Event Viewer",
            email: body.principalEmail,
          },
          role: body.role,
          grantedBy: userId,
          createdAt: "2026-09-02T20:05:00.000Z",
          expiresAt: null,
        };
        shares = [grant];
        return jsonResponse(grant, 201);
      }
      return jsonResponse(
        { error: { code: "not_found", message: `No mock for ${path}` } },
        404,
      );
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();

    render(
      <Providers>
        <EventWorkspace eventId={eventId} />
      </Providers>,
    );

    await user.click(await screen.findByRole("button", { name: "Sharing" }));
    expect(screen.getByRole("option", { name: "Viewer" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Owner" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "Editor" })).toBeNull();
    await user.type(
      screen.getByLabelText("Collaborator email"),
      "viewer@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Share event" }));

    expect(await screen.findByText("viewer@example.com")).toBeVisible();
    expect(screen.getByText("Event Viewer")).toBeVisible();
    const shareRequest = fetch.mock.calls.find(
      ([url, request]) => url === "/api/shares" && request?.method === "POST",
    );
    expect(shareRequest).toBeDefined();
    expect(JSON.parse(String(shareRequest?.[1]?.body))).toEqual({
      principalEmail: "viewer@example.com",
      resourceId: eventId,
      role: "viewer",
    });
  });
});
