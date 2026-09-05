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
const documentId = "019d6e7d-0000-7000-8000-000000000030";
const documentRelationId = "019d6e7d-0000-7000-8000-000000000031";

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

const documentAttachment = {
  relationId: documentRelationId,
  document: {
    ...rootEvent,
    id: documentId,
    objectType: "document",
    displayName: "run-of-show.pdf",
    originalFilename: "run-of-show.pdf",
    mimeType: "application/pdf",
    sizeBytes: "4096",
    checksumSha256:
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    storageProvider: "local-filesystem",
    encryptionMode: "filesystem-permissions",
  },
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

  it("keeps the event editor and navigation available when a projection fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (input) => {
        const path = requestPath(input);
        if (path.endsWith("/detail"))
          return jsonResponse({
            event: rootEvent,
            events: [],
            tasks: [],
            expenses: [],
            reminders: [],
            documents: [],
            lockedRelationCount: 0,
          });
        if (path.endsWith("/access"))
          return jsonResponse({
            resourceId: eventId,
            actions: ["view", "edit"],
          });
        if (path.endsWith("/timeline"))
          return jsonResponse({ sourceEventId: eventId, items: [] });
        return jsonResponse(
          {
            error: {
              code: "service_unavailable",
              message: "This view is temporarily unavailable.",
            },
          },
          503,
        );
      }),
    );
    const user = userEvent.setup();
    render(<EventWorkspace eventId={eventId} />, { wrapper: Providers });
    await user.click(await screen.findByRole("button", { name: "Edit event" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "My event draft" },
    });
    await user.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(
      await screen.findByRole("alert", {}, { timeout: 3000 }),
    ).toHaveTextContent("This view is temporarily unavailable.");
    expect(screen.getByLabelText("Name")).toHaveValue("My event draft");
    await user.click(screen.getByRole("tab", { name: "Overview" }));
    expect(await screen.findByText("Your event, connected.")).toBeVisible();
    expect(screen.getByLabelText("Name")).toHaveValue("My event draft");
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
      if (
        path === `/api/events/${eventId}/resources` &&
        init?.method === "POST"
      ) {
        const { resource: body } = JSON.parse(String(init.body)) as {
          resource: {
            displayName: string;
            startsAt: string;
          };
        };
        scheduledEvent = {
          ...rootEvent,
          id: scheduledEventId,
          displayName: body.displayName,
          permissionScopeId: eventId,
          startsAt: body.startsAt,
          endsAt: null,
        };
        return jsonResponse(
          {
            resource: scheduledEvent,
            relationId: "019d6e7d-0000-7000-8000-000000000012",
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
    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    expect(overviewTab).toHaveAttribute("aria-selected", "true");
    await screen.findByText("Your event, connected.");
    expect(
      fetch.mock.calls.map(([input]) => requestPath(input)).sort(),
    ).toEqual([
      `/api/events/${eventId}/detail`,
      `/api/events/${eventId}/timeline`,
      `/api/objects/${eventId}/access`,
    ]);
    overviewTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "To-dos" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("To-dos");
    await user.click(screen.getByRole("tab", { name: "Calendar" }));
    await user.click(
      await screen.findByRole("button", { name: "Add schedule item" }),
    );
    await user.type(screen.getByLabelText("Schedule item"), "Guest arrival");
    fireEvent.change(screen.getByLabelText("Starts"), {
      target: { value: "2026-10-15T17:30" },
    });
    await user.click(screen.getByRole("button", { name: "Add to schedule" }));

    expect(
      await screen.findByRole("heading", { name: "Guest arrival" }),
    ).toBeVisible();
    expect(screen.getByText("ID 00000011")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Itinerary" }));
    expect(
      screen.getByRole("heading", { name: "Guest arrival" }),
    ).toBeVisible();
    expect(screen.getByText("ID 00000011")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Timeline" }));
    expect(
      screen.getByRole("heading", { name: "Guest arrival" }),
    ).toBeVisible();
    expect(screen.getByText("ID 00000011")).toBeVisible();
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `/api/events/${eventId}/resources`,
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
      if (path === `/api/objects/${eventId}/documents`) {
        return jsonResponse({
          items: [documentAttachment],
          lockedAttachmentCount: 0,
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

    await user.click(screen.getByRole("tab", { name: "To-dos" }));
    expect(screen.getByText("Confirm guest list")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Complete Confirm guest list" }),
    ).toBeDisabled();
    expect(screen.queryByLabelText("Task")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(
      screen.queryByRole("button", { name: "Add schedule item" }),
    ).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Files" }));
    expect(await screen.findByText("run-of-show.pdf")).toBeVisible();
    expect(screen.getByText("Read-only files")).toBeVisible();
    expect(screen.getByRole("button", { name: "Download" })).toBeVisible();
    expect(screen.queryByLabelText("Choose a private file")).toBeNull();
    expect(screen.queryByRole("button", { name: "Unlink" })).toBeNull();
  });

  it("lets an owner choose attachment targets and unlink without deleting", async () => {
    const task = {
      ...rootEvent,
      id: "019d6e7d-0000-7000-8000-000000000032",
      objectType: "task",
      displayName: "Confirm venue",
      startsAt: undefined,
      endsAt: undefined,
      timezone: undefined,
      isAllDay: undefined,
      status: "todo",
      dueAt: null,
      completedAt: null,
    } as const;
    let attachments = [documentAttachment];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const path = requestPath(input);
      if (path === `/api/events/${eventId}/detail`) {
        return jsonResponse({
          event: rootEvent,
          events: [],
          tasks: [task],
          expenses: [],
          reminders: [],
          documents: [documentAttachment.document],
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
        return jsonResponse({ sourceEventId: eventId, items: [task] });
      }
      if (
        path === `/api/events/${eventId}/calendar` ||
        path === `/api/events/${eventId}/itinerary` ||
        path === `/api/events/${eventId}/expenses` ||
        path === `/api/events/${eventId}/reminders` ||
        path === `/api/events/${eventId}/timeline`
      ) {
        return jsonResponse({ sourceEventId: eventId, items: [] });
      }
      if (path === `/api/objects/${eventId}/documents`) {
        return jsonResponse({ items: attachments, lockedAttachmentCount: 0 });
      }
      if (
        path === `/api/relations/${documentRelationId}` &&
        init?.method === "DELETE"
      ) {
        attachments = [];
        return jsonResponse({
          id: documentRelationId,
          deletedAt: "2026-09-02T20:10:00.000Z",
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

    await user.click(await screen.findByRole("tab", { name: "Files" }));
    expect(await screen.findByText("run-of-show.pdf")).toBeVisible();
    expect(screen.getByLabelText("Choose a private file")).toBeVisible();
    expect(
      screen.getByRole("option", { name: "Event: Launch night" }),
    ).toBeVisible();
    expect(
      screen.getByRole("option", { name: "Task: Confirm venue" }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Unlink" }));

    await waitFor(() => {
      expect(
        fetch.mock.calls.some(
          ([url, request]) =>
            url === `/api/relations/${documentRelationId}` &&
            request?.method === "DELETE",
        ),
      ).toBe(true);
    });
    expect(await screen.findByText("No files attached")).toBeVisible();
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

    await user.click(await screen.findByRole("tab", { name: "Sharing" }));
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
