// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
  startsOn: null,
  endsOn: null,
  isAllDay: false,
} as const;

const documentAttachment = {
  relationId: documentRelationId,
  relationVersion: 1,
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
    window.history.replaceState(null, "", "/events/plan?view=overview");
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

  it.each([
    "todos",
    "calendar",
    "timeline",
    "itinerary",
    "expenses",
    "reminders",
  ])(
    "opens a focused %s deep link without loading event detail",
    async (view) => {
      window.history.replaceState(null, "", `/events/plan?view=${view}`);
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const path = requestPath(input);
        if (path === `/api/events/${eventId}`) return jsonResponse(rootEvent);
        if (path.endsWith("/access"))
          return jsonResponse({
            resourceId: eventId,
            actions: ["view", "edit"],
          });
        if (path === `/api/events/${eventId}/${view}`)
          return jsonResponse({ sourceEventId: eventId, items: [] });
        return jsonResponse(
          { error: { code: "not_found", message: "Unexpected request" } },
          404,
        );
      });
      vi.stubGlobal("fetch", fetch);
      render(<EventWorkspace eventId={eventId} />, { wrapper: Providers });
      expect(
        await screen.findByRole("heading", { name: rootEvent.displayName }),
      ).toBeVisible();
      await waitFor(() =>
        expect(
          fetch.mock.calls.map(([input]) => requestPath(input)).sort(),
        ).toEqual([
          `/api/events/${eventId}`,
          `/api/events/${eventId}/${view}`,
          `/api/objects/${eventId}/access`,
        ]),
      );
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it.each([false, true])(
    "shows exact expense rows and separate currency totals (mixed: %s)",
    async (mixed) => {
      const entries = [
        { amount: "999999999999999.9999", currency: "USD" },
        { amount: "-0.0001", currency: "USD" },
        ...(mixed ? [{ amount: "3.0003", currency: "EUR" }] : []),
      ];
      const expenses = entries.map((entry, index) => ({
        ...rootEvent,
        ...entry,
        id: `019d6e7d-0000-7000-8000-${String(index + 40).padStart(12, "0")}`,
        objectType: "expense",
        displayName: `Transaction ${index + 1}`,
        occurredAt: rootEvent.createdAt,
      }));
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof globalThis.fetch>(async (input) => {
          const path = requestPath(input);
          if (path === `/api/events/${eventId}`) return jsonResponse(rootEvent);
          if (path.endsWith("/detail"))
            return jsonResponse({
              event: rootEvent,
              events: [],
              tasks: [],
              expenses,
              reminders: [],
              documents: [],
              lockedRelationCount: 0,
            });
          if (path.endsWith("/access"))
            return jsonResponse({ resourceId: eventId, actions: ["view"] });
          if (path.endsWith("/expenses"))
            return jsonResponse({ sourceEventId: eventId, items: expenses });
          return jsonResponse(
            { error: { code: "not_found", message: "Unavailable" } },
            404,
          );
        }),
      );
      const user = userEvent.setup();
      render(
        <Providers>
          <EventWorkspace eventId={eventId} />
        </Providers>,
      );

      const summary = await screen.findByRole("button", { name: /expenses/i });
      expect(summary).toHaveTextContent(
        mixed ? "3 transactions" : "$999,999,999,999,999.9998",
      );
      await user.click(summary);
      const totals = await screen.findByLabelText("Totals by currency");
      expect(within(totals).getByText("USD")).toBeVisible();
      expect(
        within(totals).getByText("$999,999,999,999,999.9998"),
      ).toBeVisible();
      if (mixed) {
        expect(within(totals).getByText("EUR")).toBeVisible();
        expect(within(totals).getByText("\u20ac3.0003")).toBeVisible();
      }
      expect(screen.getByText("$999,999,999,999,999.9999")).toBeVisible();
      expect(screen.getByText("-$0.0001")).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Record expense" }),
      ).toBeNull();
    },
  );

  it("keeps the event editor and navigation available when event detail fails", async () => {
    window.history.replaceState(null, "", "/events/plan?view=calendar");
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const path = requestPath(input);
      if (path === `/api/events/${eventId}`) return jsonResponse(rootEvent);
      if (path.endsWith("/access"))
        return jsonResponse({ resourceId: eventId, actions: ["view", "edit"] });
      if (path.endsWith("/calendar"))
        return jsonResponse({ sourceEventId: eventId, items: [] });
      return jsonResponse(
        {
          error: {
            code: "service_unavailable",
            message: "Overview unavailable",
          },
        },
        503,
      );
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<EventWorkspace eventId={eventId} />, { wrapper: Providers });
    await user.click(await screen.findByRole("button", { name: "Edit event" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Unsaved plan" },
    });
    await user.click(screen.getByRole("tab", { name: "Overview" }));
    expect(
      await screen.findByRole("alert", {}, { timeout: 3000 }),
    ).toHaveTextContent("Overview unavailable");
    expect(screen.getByLabelText("Name")).toHaveValue("Unsaved plan");
    await user.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Name")).toHaveValue("Unsaved plan");
  });

  it("keeps the event editor and navigation available when a projection fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (input) => {
        const path = requestPath(input);
        if (path === `/api/events/${eventId}`) return jsonResponse(rootEvent);
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
      if (path === `/api/events/${eventId}`) return jsonResponse(rootEvent);
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
      `/api/events/${eventId}`,
      `/api/events/${eventId}/detail`,
      `/api/objects/${eventId}/access`,
    ]);
    overviewTab.focus();
    await user.keyboard("{Home}");
    expect(overviewTab).toHaveFocus();
    expect(overviewTab).toHaveAttribute("aria-selected", "true");
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
    await user.click(screen.getByRole("button", { name: "Change year" }));
    await user.click(screen.getByRole("button", { name: "2026" }));
    await user.click(screen.getByRole("button", { name: "Change month" }));
    await user.click(screen.getByRole("button", { name: "October" }));
    await user.click(screen.getByRole("button", { name: "Oct 15, 2026" }));
    await user.click(screen.getByRole("switch", { name: "Add times" }));
    fireEvent.change(screen.getByLabelText("Start time"), {
      target: { value: "17:30" },
    });
    await user.click(screen.getByRole("button", { name: "Add to schedule" }));

    expect(
      await screen.findByRole("heading", { name: "Guest arrival" }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("tabpanel")).getByLabelText("Object ID"),
    ).toHaveValue(scheduledEventId);

    await user.click(screen.getByRole("tab", { name: "Itinerary" }));
    expect(
      screen.getByRole("heading", { name: "Guest arrival" }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("tabpanel")).getByLabelText("Object ID"),
    ).toHaveValue(scheduledEventId);

    await user.click(screen.getByRole("tab", { name: "Timeline" }));
    expect(
      screen.getByRole("heading", { name: "Guest arrival" }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("tabpanel")).getByLabelText("Object ID"),
    ).toHaveValue(scheduledEventId);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `/api/events/${eventId}/resources`,
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(
      fetch.mock.calls.filter(([input]) =>
        requestPath(input).endsWith("/detail"),
      ),
    ).toHaveLength(1);
    await user.click(screen.getByRole("tab", { name: "Overview" }));
    await screen.findByText("Your event, connected.");
    await waitFor(() =>
      expect(
        fetch.mock.calls.filter(([input]) =>
          requestPath(input).endsWith("/detail"),
        ),
      ).toHaveLength(2),
    );
    expect(
      screen.getByRole("button", { name: /Scheduled items/ }),
    ).toHaveTextContent("1");
  });

  it("renders a shared Event as read-only without leaking private relations", async () => {
    window.history.replaceState(null, "", "/events/plan?view=sharing");
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
      if (path === `/api/events/${eventId}`) return jsonResponse(rootEvent);
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
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.setAttribute("open", "");
        },
      },
      close: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.removeAttribute("open");
        },
      },
    });
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
      if (path === `/api/events/${eventId}`) return jsonResponse(rootEvent);
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
      if (
        path === `/api/objects/${eventId}/access` ||
        path === `/api/objects/${documentId}/access`
      ) {
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
        path === `/api/relations/${documentRelationId}?expectedVersion=1` &&
        init?.method === "DELETE"
      ) {
        attachments = [];
        return jsonResponse({
          id: documentRelationId,
          version: 2,
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

    await user.click(
      screen.getByRole("button", { name: "Actions for run-of-show.pdf" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Remove context link" }),
    );
    await user.click(screen.getByRole("checkbox", { name: /I understand/ }));
    await user.click(screen.getByRole("button", { name: "Confirm removal" }));

    await waitFor(() => {
      expect(
        fetch.mock.calls.some(
          ([url, request]) =>
            url === `/api/relations/${documentRelationId}?expectedVersion=1` &&
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
      if (path === `/api/events/${eventId}`) return jsonResponse(rootEvent);
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
