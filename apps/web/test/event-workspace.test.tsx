// @vitest-environment jsdom

import type { EventResponse } from "@chronelle/schemas";
import { useQueryClient } from "@tanstack/react-query";
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

import { Providers } from "../app/providers";
import {
  useContextCommands,
  WorkspaceCommandProvider,
} from "../components/context-commands";
import { EventWorkspace } from "../features/events/event-workspace";
import { queryKeys } from "../lib/queries";
import { openTaskEditor } from "./quick-add-support";
import { setDates } from "./range-picker-support";

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

/** A small text file the client can hash; jsdom's File has no arrayBuffer. */
function textFile(name: string, text: string): File {
  const file = new File([text], name, { type: "text/plain" });
  Object.defineProperty(file, "arrayBuffer", {
    value: () => Promise.resolve(new TextEncoder().encode(text).buffer),
  });
  return file;
}

function RefreshProbe() {
  const client = useQueryClient();
  return (
    <button
      type="button"
      onClick={() =>
        void client.invalidateQueries({ queryKey: queryKeys.event(eventId) })
      }
    >
      Refetch event data
    </button>
  );
}

function CommandProbe() {
  const commands = useContextCommands();
  return (
    <output aria-label="Available event actions">
      {commands.map((command) => command.label).join(", ")}
    </output>
  );
}

describe("EventWorkspace", () => {
  beforeEach(() => {
    for (const method of ["showModal", "close"] as const) {
      Object.defineProperty(HTMLDialogElement.prototype, method, {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.toggleAttribute("open", method === "showModal");
        },
      });
    }
    window.history.replaceState(null, "", "/events/plan?view=overview");
    window.sessionStorage.setItem(
      "chronelle.session",
      JSON.stringify({ accessToken: "test-session", workspaceId }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it.each(["viewer", 403, 404, 503] as const)(
    "handles inspector access refresh %s without retaining denied drafts",
    async (failure) => {
      window.history.replaceState(null, "", "/events/plan?view=calendar");
      let changed = false;
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input) => {
          const path = requestPath(input);
          if (path === `/api/events/${eventId}`) return jsonResponse(rootEvent);
          if (path.endsWith("/access")) {
            if (changed && failure !== "viewer")
              return jsonResponse(
                {
                  error: { code: "unavailable", message: "Access unavailable" },
                },
                failure,
              );
            return jsonResponse({
              resourceId: eventId,
              actions: changed ? ["view"] : ["view", "edit"],
              source: { kind: "own" },
            });
          }
          return jsonResponse({ sourceEventId: eventId, items: [] });
        }),
      );
      const user = userEvent.setup();
      render(
        <>
          <EventWorkspace eventId={eventId} />
          <RefreshProbe />
        </>,
        { wrapper: Providers },
      );
      await user.click(
        await screen.findByRole("button", { name: "Edit event" }),
      );
      await user.type(screen.getByLabelText("Name"), " private draft");
      changed = true;
      fireEvent.click(
        screen.getByRole("button", { name: "Refetch event data" }),
      );
      if (failure === 503) {
        await screen.findByText("Access unavailable", {}, { timeout: 3000 });
        expect(screen.getByLabelText("Name")).toHaveValue(
          "Launch night private draft",
        );
      } else {
        await waitFor(
          () => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
          { timeout: 3000 },
        );
        expect(
          screen.queryByDisplayValue("Launch night private draft"),
        ).not.toBeInTheDocument();
        const unload = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(unload);
        expect(unload.defaultPrevented).toBe(false);
      }
    },
  );

  it("starts arranging from the More menu, on the Pages view", async () => {
    window.history.replaceState(null, "", "/events/plan?view=todos");
    // The page strip measures itself.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    const layout = {
      eventId,
      version: 1,
      updatedAt: rootEvent.createdAt,
      pages: [
        {
          id: "019d6e7d-0000-7000-8000-000000000050",
          name: "Plan",
          components: [
            { id: "019d6e7d-0000-7000-8000-000000000051", kind: "todos" },
          ],
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (input) => {
        const path = requestPath(input);
        if (path.endsWith("/access"))
          return jsonResponse({
            resourceId: eventId,
            actions: ["view", "edit"],
            source: { kind: "own" },
          });
        if (path === `/api/events/${eventId}`) return jsonResponse(rootEvent);
        if (path === `/api/events/${eventId}/layout`)
          return jsonResponse(layout);
        return jsonResponse({ sourceEventId: eventId, items: [] });
      }),
    );
    const user = userEvent.setup();
    render(<EventWorkspace eventId={eventId} />, { wrapper: Providers });
    expect(
      await screen.findByRole("tab", { name: "To-dos", selected: true }),
    ).toBeVisible();
    const more = () =>
      screen.getByRole("button", {
        name: `Actions for ${rootEvent.displayName}`,
      });
    await user.click(more());
    const undo = await screen.findByRole("menuitem", { name: /^Undo edit/ });
    expect(undo).toHaveAttribute(
      "aria-keyshortcuts",
      expect.stringMatching(/\+z$/),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Arrange components" }),
    );
    // The Pages view comes forward, its page current in the strip.
    const bar = await screen.findByRole("group", {
      name: "Arranging components",
    });
    expect(screen.getByRole("button", { name: "Plan" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("tab", { selected: true })).toBeNull();
    expect(
      within(bar).getByRole("button", { name: "Done arranging" }),
    ).toBeVisible();
    // While arranging, the menu no longer offers to start.
    await user.click(more());
    await screen.findByRole("menuitem", { name: /^Undo edit/ });
    expect(
      screen.queryByRole("menuitem", { name: "Arrange components" }),
    ).toBeNull();
    await user.keyboard("{Escape}");
    await user.click(
      within(bar).getByRole("button", { name: "Done arranging" }),
    );
    expect(
      screen.queryByRole("group", { name: "Arranging components" }),
    ).toBeNull();
  });

  it("names where a grantee's access comes from and opens Sharing for an owner", async () => {
    window.history.replaceState(null, "", "/events/plan?view=todos");
    const source = {
      kind: "direct",
      grantedBy: {
        id: "019b0000-0000-7000-8000-0000000000a1",
        displayName: "Mei",
      },
      role: "owner",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (input) => {
        const path = requestPath(input);
        if (path.endsWith("/access"))
          return jsonResponse({
            resourceId: eventId,
            actions: ["view", "comment", "edit", "share", "delete"],
            source,
          });
        if (path === `/api/events/${eventId}`) return jsonResponse(rootEvent);
        if (path === `/api/events/${eventId}/detail`)
          return jsonResponse({
            event: rootEvent,
            events: [],
            tasks: [],
            expenses: [],
            reminders: [],
            documents: [],
            lockedRelationCount: 0,
          });
        if (path.endsWith("/shares")) return jsonResponse({ items: [] });
        if (path === "/api/persons") return jsonResponse({ items: [] });
        return jsonResponse({ sourceEventId: eventId, items: [] });
      }),
    );
    const user = userEvent.setup();
    render(<EventWorkspace eventId={eventId} />, { wrapper: Providers });
    const line = await screen.findByRole("button", {
      name: "Shared with you by Mei as owner",
    });
    await user.click(line);
    expect(
      await screen.findByRole("tab", { name: "Sharing", selected: true }),
    ).toBeVisible();
    expect(await screen.findByLabelText("Collaborator email")).toBeVisible();
  });

  it("shows the inherited line as a link to the granting event and nothing for the owner", async () => {
    window.history.replaceState(null, "", "/events/plan?view=todos");
    const respond = (source: unknown) =>
      vi.fn<typeof globalThis.fetch>(async (input) => {
        const path = requestPath(input);
        if (path.endsWith("/access"))
          return jsonResponse({
            resourceId: eventId,
            actions: ["view"],
            source,
          });
        if (path === `/api/events/${eventId}`) return jsonResponse(rootEvent);
        return jsonResponse({ sourceEventId: eventId, items: [] });
      });
    vi.stubGlobal(
      "fetch",
      respond({
        kind: "inherited",
        through: {
          id: "019b0000-0000-7000-8000-0000000000e2",
          displayName: "Kyoto in November",
        },
        grantedBy: {
          id: "019b0000-0000-7000-8000-0000000000a1",
          displayName: "Mei",
        },
        role: "viewer",
      }),
    );
    const first = render(<EventWorkspace eventId={eventId} />, {
      wrapper: Providers,
    });
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: rootEvent.displayName,
      }),
    ).toBeVisible();
    expect(
      await screen.findByRole("link", {
        name: "Through Kyoto in November, shared by Mei",
      }),
    ).toHaveAttribute("href", "/events/019b0000-0000-7000-8000-0000000000e2");
    first.unmount();
    vi.stubGlobal("fetch", respond({ kind: "own" }));
    render(<EventWorkspace eventId={eventId} />, { wrapper: Providers });
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: rootEvent.displayName,
      }),
    ).toBeVisible();
    expect(screen.queryByText(/shared by|Shared with you/)).toBeNull();
  });

  it.each([
    ["todos", "No tasks yet"],
    ["calendar", "Nothing scheduled"],
    ["expenses", "No expenses recorded"],
    ["reminders", "No reminders"],
  ])("gives viewers a read-only %s empty state", async (view, title) => {
    window.history.replaceState(null, "", `/events/plan?view=${view}`);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (input) => {
        const path = requestPath(input);
        if (path.endsWith("/access"))
          return jsonResponse({
            resourceId: eventId,
            actions: ["view"],
            source: { kind: "own" },
          });
        if (path === `/api/events/${eventId}`) return jsonResponse(rootEvent);
        return jsonResponse({ sourceEventId: eventId, items: [] });
      }),
    );
    render(<EventWorkspace eventId={eventId} />, { wrapper: Providers });
    // The empty state is its title alone; a viewer gets no way to add.
    expect(await screen.findByRole("heading", { name: title })).toBeVisible();
    expect(
      screen.queryByRole("textbox", {
        name: /Task|Schedule item|Expense|Reminder/,
      }),
    ).toBeNull();
    // The only add control a viewer keeps is the strip's own gallery.
    expect(
      screen
        .queryAllByRole("button", { name: /^Add / })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Add a view"]);
  });

  it.each(
    ["resource", "access", "todos"].flatMap((source) =>
      [503, 403, 404].map((status) => ({ source, status })),
    ),
  )(
    "handles $source refresh status $status without retaining denied content",
    async ({ source, status }) => {
      window.history.replaceState(null, "", "/events/plan?view=todos");
      let fail = false;
      const user = userEvent.setup();
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof globalThis.fetch>(async (input) => {
          const path = requestPath(input);
          const target =
            source === "resource"
              ? `/api/events/${eventId}`
              : source === "access"
                ? `/api/objects/${eventId}/access`
                : `/api/events/${eventId}/todos`;
          if (fail && path === target)
            return jsonResponse(
              {
                error: {
                  code: "unavailable",
                  message: "Event data unavailable",
                },
              },
              status,
            );
          if (path.endsWith("/access"))
            return jsonResponse({
              resourceId: eventId,
              actions: ["view", "edit"],
              source: { kind: "own" },
            });
          if (path === `/api/events/${eventId}`) return jsonResponse(rootEvent);
          return jsonResponse({ sourceEventId: eventId, items: [] });
        }),
      );
      render(
        <WorkspaceCommandProvider pathname={`/events/${eventId}`}>
          <EventWorkspace eventId={eventId} />
          <RefreshProbe />
          <CommandProbe />
        </WorkspaceCommandProvider>,
        { wrapper: Providers },
      );
      await openTaskEditor(user);
      const input = await screen.findByRole("textbox", { name: "Task" });
      expect(
        screen.getByLabelText("Available event actions"),
      ).toHaveTextContent("Edit event, Event history");
      await user.type(input, "Keep my draft");
      fail = true;
      await user.click(
        screen.getByRole("button", { name: "Refetch event data" }),
      );
      expect(
        await screen.findByRole("alert", {}, { timeout: 3000 }),
      ).toHaveTextContent("Event data unavailable");
      if (status !== 503 && source !== "todos") {
        expect(
          screen.getByLabelText("Available event actions"),
        ).toBeEmptyDOMElement();
      } else {
        expect(
          screen.getByLabelText("Available event actions"),
        ).toHaveTextContent("Edit event, Event history");
      }
      if (status === 503) {
        expect(screen.getByRole("textbox", { name: "Task" })).toBe(input);
        expect(input).toHaveValue("Keep my draft");
      } else {
        expect(screen.queryByRole("textbox", { name: "Task" })).toBeNull();
      }
      fail = false;
      await user.click(
        screen.getByRole("button", { name: "Refetch event data" }),
      );
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
      if (status !== 503) await openTaskEditor(user);
      expect(await screen.findByRole("textbox", { name: "Task" })).toHaveValue(
        status === 503 ? "Keep my draft" : "",
      );
    },
  );

  it.each([
    ["todos", "todos"],
    ["calendar", "calendar"],
    ["timeline", "timeline"],
    // The Itinerary tab folded into the Calendar; its link still opens.
    ["itinerary", "calendar"],
    ["expenses", "expenses"],
    ["reminders", "reminders"],
  ])(
    "opens a focused %s deep link without loading event detail",
    async (link, view) => {
      window.history.replaceState(null, "", `/events/plan?view=${link}`);
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const path = requestPath(input);
        if (path === `/api/events/${eventId}`) return jsonResponse(rootEvent);
        if (path.endsWith("/access"))
          return jsonResponse({
            resourceId: eventId,
            actions: ["view", "edit"],
            source: { kind: "own" },
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
      const paths = () => fetch.mock.calls.map(([input]) => requestPath(input));
      await waitFor(() =>
        expect(paths()).toEqual(
          expect.arrayContaining([
            `/api/events/${eventId}`,
            `/api/events/${eventId}/${view}`,
            `/api/events/${eventId}/layout`,
            `/api/objects/${eventId}/access`,
          ]),
        ),
      );
      expect(paths()).not.toContain(`/api/events/${eventId}/detail`);
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
            return jsonResponse({
              resourceId: eventId,
              actions: ["view"],
              source: { kind: "own" },
            });
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
        return jsonResponse({
          resourceId: eventId,
          actions: ["view", "edit"],
          source: { kind: "own" },
        });
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
            source: { kind: "own" },
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
    expect(await screen.findByText("Next up")).toBeVisible();
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
          source: { kind: "own" },
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
    await screen.findByText("Next up");
    expect(
      fetch.mock.calls.map(([input]) => requestPath(input)).sort(),
    ).toEqual([
      "/api/auth/session",
      `/api/events/${eventId}`,
      `/api/events/${eventId}/detail`,
      `/api/events/${eventId}/layout`,
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
    await setDates(user, "2026-10-15");
    await user.click(screen.getByRole("switch", { name: "Add times" }));
    fireEvent.change(screen.getByLabelText("Start time"), {
      target: { value: "17:30" },
    });
    await user.click(screen.getByRole("button", { name: "Add to schedule" }));

    expect(
      await screen.findByRole("heading", { name: "Guest arrival" }),
    ).toBeVisible();

    // The Calendar's agenda view is the running order the Itinerary showed.
    expect(screen.queryByRole("tab", { name: "Itinerary" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /^Layout: / }));
    await user.click(screen.getByRole("menuitemradio", { name: "Agenda" }));
    expect(
      screen.getByRole("heading", { name: "Guest arrival" }),
    ).toBeVisible();
    expect(screen.getByText("01")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Timeline" }));
    expect(
      screen.getByRole("heading", { name: "Guest arrival" }),
    ).toBeVisible();
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
    await screen.findByText("Next up");
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
        return jsonResponse({
          resourceId: eventId,
          actions: ["view"],
          source: { kind: "own" },
        });
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
    expect(
      screen.getByRole("button", { name: "Download run-of-show.pdf" }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Choose a private file")).toBeNull();
    expect(screen.queryByText("Attach a file")).toBeNull();
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
          source: { kind: "own" },
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
    expect(screen.getByText("Attach a file")).toBeVisible();
    // The targets are one quiet menu in the heading, the event chosen first.
    await user.click(
      screen.getByRole("button", { name: "Attached to: Event: Launch night" }),
    );
    expect(
      screen.getByRole("menuitemradio", { name: "Event: Launch night" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("menuitemradio", { name: "Task: Confirm venue" }),
    ).toBeVisible();
    await user.keyboard("{Escape}");

    await user.click(
      screen.getByRole("button", { name: "Actions for run-of-show.pdf" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
    await user.click(
      await screen.findByRole("button", { name: "Remove from this event" }),
    );

    await waitFor(() => {
      expect(
        fetch.mock.calls.some(
          ([url, request]) =>
            url === `/api/relations/${documentRelationId}?expectedVersion=1` &&
            request?.method === "DELETE",
        ),
      ).toBe(true);
    });
    await waitFor(() =>
      expect(document.querySelectorAll(".attachment-row")).toHaveLength(0),
    );
    expect(screen.getByText("Attach a file")).toBeVisible();
  });

  it("shows the Files states with the shared frame: locked count, empty target, load error, pending and failed uploads", async () => {
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
    let taskDocumentsFail = true;
    const uploadAnswer: "hang" | "fail" = "hang";
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const path = requestPath(input);
      if (path === `/api/events/${eventId}`) return jsonResponse(rootEvent);
      if (path === `/api/events/${eventId}/detail`)
        return jsonResponse({
          event: rootEvent,
          events: [],
          tasks: [task],
          expenses: [],
          reminders: [],
          documents: [documentAttachment.document],
          lockedRelationCount: 0,
        });
      if (path.endsWith("/access"))
        return jsonResponse({
          resourceId: eventId,
          actions: ["view", "comment", "edit", "share", "delete"],
          source: { kind: "own" },
        });
      if (path.startsWith(`/api/events/${eventId}/`))
        return jsonResponse({ sourceEventId: eventId, items: [] });
      if (path === `/api/objects/${eventId}/documents`)
        return jsonResponse({
          items: [documentAttachment],
          lockedAttachmentCount: 2,
        });
      if (path === `/api/objects/${task.id}/documents`) {
        if (taskDocumentsFail)
          return jsonResponse(
            {
              error: {
                code: "unavailable",
                message: "The attachments could not be read.",
                requestId: "test",
              },
            },
            503,
          );
        return jsonResponse({ items: [], lockedAttachmentCount: 0 });
      }
      if (path === "/api/documents/upload-url" && init?.method === "POST") {
        if (uploadAnswer === "hang") return new Promise(() => {});
        return jsonResponse(
          {
            error: {
              code: "unavailable",
              message: "Uploads are unavailable right now.",
              requestId: "test",
            },
          },
          503,
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
    await user.click(await screen.findByRole("tab", { name: "Files" }));
    expect(await screen.findByText("run-of-show.pdf")).toBeVisible();
    // Attachments outside the caller's scope are counted the way the
    // Overview counts private related items.
    expect(screen.getByText("Private attachments")).toBeVisible();
    expect(
      screen.getByText("2 attachments are outside your permission scope."),
    ).toBeVisible();

    // A target whose attachments cannot be read shows the error with a retry;
    // once readable, the editor has the attach row alone.
    await user.click(
      screen.getByRole("button", { name: "Attached to: Event: Launch night" }),
    );
    await user.click(
      screen.getByRole("menuitemradio", { name: "Task: Confirm venue" }),
    );
    // The read is retried once before the notice appears.
    expect(
      await screen.findByText(
        "The attachments could not be read.",
        {},
        { timeout: 5_000 },
      ),
    ).toBeVisible();
    taskDocumentsFail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Attach a file")).toBeVisible();
    expect(screen.queryByText("No files attached")).toBeNull();
    expect(screen.queryByText("Private attachments")).toBeNull();

    // A chosen file goes up at once; while it does, the row says so and the
    // file and target controls are held.
    const fileInput = screen.getByLabelText("Choose a private file");
    await user.upload(fileInput, textFile("notes.txt", "hello"));
    expect(
      await screen.findByRole("button", { name: "Uploading notes.txt..." }),
    ).toBeDisabled();
    expect(
      screen.getByRole("progressbar", { name: "Uploading attachment" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Choose a private file")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Attached to: Task: Confirm venue" }),
    ).toBeDisabled();
  });

  it("dismisses a failed upload's notice and frees the controls", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const path = requestPath(input);
      if (path === `/api/events/${eventId}`) return jsonResponse(rootEvent);
      if (path === `/api/events/${eventId}/detail`)
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
          actions: ["view", "comment", "edit", "share", "delete"],
          source: { kind: "own" },
        });
      if (path.startsWith(`/api/events/${eventId}/`))
        return jsonResponse({ sourceEventId: eventId, items: [] });
      if (path === `/api/objects/${eventId}/documents`)
        return jsonResponse({ items: [], lockedAttachmentCount: 0 });
      if (path === "/api/documents/upload-url" && init?.method === "POST")
        return jsonResponse(
          {
            error: {
              code: "unavailable",
              message: "Uploads are unavailable right now.",
              requestId: "test",
            },
          },
          503,
        );
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
    expect(await screen.findByText("Attach a file")).toBeVisible();
    await user.upload(
      screen.getByLabelText("Choose a private file"),
      textFile("notes.txt", "hello"),
    );
    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("Uploads are unavailable right now.");
    // The limit and the checks are read only once a file is refused.
    expect(
      screen.getByText(
        "Maximum 25 MB. Filename, type, size, and checksum are verified.",
      ),
    ).toBeVisible();
    // The row is free for another try; Dismiss clears the notice.
    expect(screen.getByRole("button", { name: "Attach a file" })).toBeEnabled();
    await user.click(within(notice).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Maximum 25 MB/)).toBeNull();
    expect(screen.getByLabelText("Choose a private file")).toBeEnabled();
  });

  it("shares an Event with an existing development user", async () => {
    const grantId = "019d6e7d-0000-7000-8000-000000000020";
    const collaboratorId = "019d6e7d-0000-7000-8000-000000000021";
    let shares: unknown[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const path = requestPath(input);
      if (path === "/api/persons") return jsonResponse({ items: [] });
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
          source: { kind: "own" },
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
    // Every role the API takes is offered: Viewer, Editor, Owner.
    expect(screen.getByRole("option", { name: "Viewer" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Editor" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Owner" })).toBeVisible();
    await user.type(
      screen.getByLabelText("Collaborator email"),
      "viewer@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

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

  it("shares an Event with several people at once and reports each outcome", async () => {
    const friendUserId = "019d6e7d-0000-7000-8000-000000000040";
    const linkedUserId = "019d6e7d-0000-7000-8000-000000000041";
    const person = (id: string, fields: Record<string, unknown>) => ({
      ...rootEvent,
      id,
      objectType: "person",
      startsAt: null,
      endsAt: null,
      timezone: null,
      email: null,
      userId: null,
      ...fields,
    });
    // Mei is a friend with a card; Ivo a friend without one; Mira another
    // account here; Sam has an email; Pat was invited from their card;
    // Nobody has neither; Me is the acting user's own card.
    const people = [
      person("019d6e7d-0000-7000-8000-000000000050", {
        displayName: "Mei Lin",
        nickname: "Mei",
        userId: friendUserId,
      }),
      person("019d6e7d-0000-7000-8000-000000000051", {
        displayName: "Mira",
        userId: linkedUserId,
      }),
      person("019d6e7d-0000-7000-8000-000000000052", {
        displayName: "Sam",
        email: "sam@example.com",
      }),
      person("019d6e7d-0000-7000-8000-000000000055", {
        displayName: "Pat",
        email: "pat@example.com",
      }),
      person("019d6e7d-0000-7000-8000-000000000053", {
        displayName: "Nobody",
      }),
      person("019d6e7d-0000-7000-8000-000000000054", {
        displayName: "Me",
        userId,
      }),
    ];
    const friends = {
      friends: [
        {
          id: "019d6e7d-0000-7000-8000-000000000071",
          userId: friendUserId,
          displayName: "Mei Lin",
          email: "mei@example.com",
          since: "2026-09-02T09:00:00.000Z",
        },
        {
          id: "019d6e7d-0000-7000-8000-000000000072",
          userId: "019d6e7d-0000-7000-8000-000000000042",
          displayName: "Ivo",
          email: "ivo@example.com",
          since: "2026-09-02T09:00:00.000Z",
        },
      ],
      incoming: [],
      sent: [
        {
          id: "019d6e7d-0000-7000-8000-000000000073",
          kind: "invitation",
          email: "pat@example.com",
          message: null,
          personId: "019d6e7d-0000-7000-8000-000000000055",
          workspaceId,
          createdAt: "2026-09-02T09:00:00.000Z",
          expiresAt: "2026-09-16T09:00:00.000Z",
        },
      ],
    };
    const shares: unknown[] = [];
    const pending: unknown[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const path = requestPath(input);
      if (path === "/api/persons") return jsonResponse({ items: people });
      if (path === "/api/friends") return jsonResponse(friends);
      if (path === "/api/auth/session")
        return jsonResponse({
          principal: { type: "user", userId, workspaceId },
          user: { id: userId, displayName: "Owner", email: null },
          workspace: { id: workspaceId, displayName: "Home" },
          availableWorkspaces: [{ id: workspaceId, displayName: "Home" }],
        });
      if (path === `/api/events/${eventId}`) return jsonResponse(rootEvent);
      if (path === `/api/events/${eventId}/detail`)
        return jsonResponse({
          event: rootEvent,
          events: [],
          tasks: [],
          expenses: [],
          reminders: [],
          documents: [],
          lockedRelationCount: 0,
        });
      if (path === `/api/objects/${eventId}/access`)
        return jsonResponse({
          resourceId: eventId,
          actions: ["view", "comment", "edit", "share", "delete"],
          source: { kind: "own" },
        });
      if (path.startsWith(`/api/events/${eventId}/`))
        return jsonResponse({ sourceEventId: eventId, items: [] });
      if (path === `/api/objects/${eventId}/shares`)
        return jsonResponse({ items: shares, pending });
      if (path === "/api/shares/pending" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          personId: string;
          role: string;
        };
        const card = people.find((item) => item.id === body.personId);
        const queued = {
          id: `019d6e7d-0000-7000-8000-00000000008${pending.length}`,
          workspaceId,
          resourceId: eventId,
          role: body.role,
          status: "pending",
          kind: "invitation",
          itemId: "019d6e7d-0000-7000-8000-000000000073",
          person: { id: body.personId, displayName: card?.displayName ?? "" },
          email: card?.email ?? null,
          grantedBy: userId,
          createdAt: "2026-09-02T20:05:00.000Z",
        };
        pending.push(queued);
        return jsonResponse(queued, 201);
      }
      if (path === "/api/shares" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          personId?: string;
          friendId?: string;
          role: string;
        };
        if (body.personId === people[1]?.id)
          return jsonResponse(
            {
              error: {
                code: "principal_unavailable",
                message: "The requested user is unavailable.",
                requestId: "test",
              },
            },
            404,
          );
        const grant = {
          id: `019d6e7d-0000-7000-8000-00000000006${shares.length}`,
          workspaceId,
          resourceId: eventId,
          principal: {
            id: body.friendId === undefined ? linkedUserId : friendUserId,
            displayName: body.friendId === undefined ? "Mira" : "Mei Lin",
            email: null,
          },
          role: body.role,
          grantedBy: userId,
          createdAt: "2026-09-02T20:05:00.000Z",
          expiresAt: null,
        };
        shares.push(grant);
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
    const friendList = within(
      await screen.findByRole("list", { name: "Friends" }),
    );
    const others = within(
      screen.getByRole("list", { name: "Others in People" }),
    );
    // Friends come first, by their card's name when they have one; the
    // other people with an account, an invitation, or an email follow. The
    // acting user's own card and a person with neither are not offered.
    expect(
      friendList
        .getAllByRole("checkbox")
        .map((box) => box.getAttribute("name")),
    ).toHaveLength(2);
    expect(friendList.getByRole("checkbox", { name: /^Mei / })).toBeVisible();
    expect(friendList.getByRole("checkbox", { name: /Ivo/ })).toBeVisible();
    expect(others.getAllByRole("checkbox")).toHaveLength(3);
    expect(others.getByText("Has an account")).toBeVisible();
    expect(
      others.getByText("Invited; access follows when they join"),
    ).toBeVisible();
    expect(others.getByText(/sam@example\.com; an invitation/)).toBeVisible();
    expect(others.queryByText("Nobody")).toBeNull();
    expect(others.queryByText("Me")).toBeNull();
    const shareButton = screen.getByRole("button", { name: /^Share with/ });
    expect(shareButton).toBeDisabled();
    await user.click(friendList.getByRole("checkbox", { name: /^Mei / }));
    await user.click(others.getByRole("checkbox", { name: /Mira/ }));
    await user.click(others.getByRole("checkbox", { name: /Sam/ }));
    await user.click(others.getByRole("checkbox", { name: /Pat/ }));
    expect(shareButton).toHaveTextContent("Share with 4 people");
    await user.click(shareButton);
    // Each row reports its own outcome; the refused person stays ticked
    // for another try and the others clear.
    expect(await friendList.findByText("Shared as Viewer")).toBeVisible();
    expect(
      await others.findByText("The requested user is unavailable."),
    ).toBeVisible();
    expect(
      await others.findByText("Invitation sent; access follows when they join"),
    ).toBeVisible();
    expect(await others.findByText("Waiting for them to join")).toBeVisible();
    expect(others.getByRole("checkbox", { name: /Mira/ })).toBeChecked();
    expect(
      friendList.getByRole("checkbox", { name: /^Mei / }),
    ).not.toBeChecked();
    const bodies = fetch.mock.calls
      .filter(
        ([url, request]) =>
          (url === "/api/shares" || url === "/api/shares/pending") &&
          request?.method === "POST",
      )
      .map(([url, request]) => [url, JSON.parse(String(request?.body))]);
    expect(bodies).toEqual([
      [
        "/api/shares",
        {
          friendId: "019d6e7d-0000-7000-8000-000000000071",
          resourceId: eventId,
          role: "viewer",
        },
      ],
      [
        "/api/shares",
        { personId: people[1]?.id, resourceId: eventId, role: "viewer" },
      ],
      [
        "/api/shares/pending",
        { personId: people[2]?.id, resourceId: eventId, role: "viewer" },
      ],
      [
        "/api/shares/pending",
        { personId: people[3]?.id, resourceId: eventId, role: "viewer" },
      ],
    ]);
    // People with access lists the grant and the waiting shares; Mei's
    // row shows the role she now holds.
    expect(
      await screen.findByText("Mei Lin", { selector: "strong" }),
    ).toBeVisible();
    expect(
      screen.getAllByText(/example\.com \S Access follows when they join/),
    ).toHaveLength(2);
    expect(
      within(
        friendList
          .getByRole("checkbox", { name: /^Mei / })
          .closest("li") as HTMLElement,
      ).getByText(/already Viewer/),
    ).toBeVisible();
  });

  it("keeps the account's tabs for the event: the gallery adds and removes a view, Manage tabs hides and reorders", async () => {
    window.history.replaceState(null, "", "/events/plan?view=todos");
    const session = {
      principal: { type: "user", userId, workspaceId },
      user: {
        id: userId,
        displayName: "Planner",
        email: "planner@example.test",
        locale: null,
        timeZone: null,
        hourCycle: null,
        weekStart: null,
        rail: {},
        eventTabs: { [eventId]: { removed: ["files"] } },
      },
      workspace: { id: workspaceId, displayName: "Personal" },
      availableWorkspaces: [{ id: workspaceId, displayName: "Personal" }],
    };
    const layout = {
      eventId,
      version: 1,
      updatedAt: rootEvent.createdAt,
      pages: [
        {
          id: "019d6e7d-0000-7000-8000-000000000050",
          name: "Plan",
          components: [],
        },
      ],
    };
    const patches: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/auth/session") return jsonResponse(session);
        if (path === "/api/auth/me" && init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as {
            eventTabs: Record<string, unknown>;
          };
          patches.push(body.eventTabs[eventId]);
          session.user.eventTabs = {
            ...session.user.eventTabs,
            ...(body.eventTabs as Record<string, { removed: string[] }>),
          };
          return jsonResponse(session.user);
        }
        if (path.endsWith("/access"))
          return jsonResponse({
            resourceId: eventId,
            actions: ["view", "edit", "share"],
            source: { kind: "own" },
          });
        if (path === `/api/events/${eventId}`) return jsonResponse(rootEvent);
        if (path === `/api/events/${eventId}/layout`)
          return jsonResponse(layout);
        return jsonResponse({ sourceEventId: eventId, items: [] });
      }),
    );
    const user = userEvent.setup();
    render(<EventWorkspace eventId={eventId} />, { wrapper: Providers });
    const tabNames = () =>
      screen.getAllByRole("tab").map((tab) => tab.textContent);
    await screen.findByRole("tab", { name: "To-dos", selected: true });
    // The stored preference leaves Files off the strip.
    await waitFor(() => expect(tabNames()).not.toContain("Files"));
    expect(tabNames()).toEqual([
      "Overview",
      "To-dos",
      "Calendar",
      "Timeline",
      "Expenses",
      "Reminders",
      "People",
      "Sharing",
      "Removed links",
    ]);

    // The gallery: Files comes back at the end; Timeline goes; the
    // dialog stays open; a fixed view offers no switch.
    await user.click(screen.getByRole("button", { name: "Add a view" }));
    const gallery = await screen.findByRole("dialog", {
      name: "Add to Launch night",
    });
    const card = (name: RegExp) =>
      within(gallery).getByRole("button", { name });
    expect(card(/^Files/)).toHaveAttribute("aria-pressed", "false");
    expect(card(/^To-dos/)).toHaveAttribute("aria-disabled", "true");
    await user.click(card(/^Files/));
    await user.click(card(/^Timeline/));
    expect(gallery).toBeVisible();
    await waitFor(() =>
      expect(card(/^Timeline/)).toHaveAttribute("aria-pressed", "false"),
    );
    expect(patches).toEqual([
      expect.objectContaining({ removed: [] }),
      expect.objectContaining({ removed: ["timeline"] }),
    ]);
    expect(tabNames()).toEqual([
      "Overview",
      "To-dos",
      "Calendar",
      "Expenses",
      "Reminders",
      "People",
      "Sharing",
      "Removed links",
      "Files",
    ]);
    await user.click(within(gallery).getByRole("button", { name: "Done" }));

    // Manage tabs: the eye hides Expenses (kept in the list), the grip's
    // arrow key moves Calendar down past it and Reminders, a fixed view
    // has no cross.
    await user.click(
      screen.getByRole("button", { name: "Actions for Launch night" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Manage tabs" }));
    const manage = await screen.findByRole("dialog", { name: "Manage tabs" });
    expect(
      within(manage).queryByRole("button", { name: /^Remove Overview/ }),
    ).toBeNull();
    expect(
      within(manage).getByRole("button", {
        name: "Remove Calendar from the event",
      }),
    ).toBeVisible();
    await user.click(
      within(manage).getByRole("button", { name: "Hide Expenses" }),
    );
    expect(
      within(manage).getByRole("button", { name: "Show Expenses" }),
    ).toBeVisible();
    within(manage).getByRole("button", { name: "Move Calendar" }).focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await waitFor(() =>
      expect(tabNames()).toEqual([
        "Overview",
        "To-dos",
        "Reminders",
        "Calendar",
        "People",
        "Sharing",
        "Removed links",
        "Files",
      ]),
    );
    expect(patches.at(-1)).toEqual({
      order: [
        "overview",
        "todos",
        "expenses",
        "reminders",
        "calendar",
        "people",
        "sharing",
        "removed-links",
        "files",
      ],
      hidden: ["expenses"],
      removed: ["timeline"],
    });
    await user.click(within(manage).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
