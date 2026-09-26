// @vitest-environment jsdom

import type { SessionResponse } from "@livtales/schemas";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { MoveToSpaceDialog } from "../features/spaces/move-to-space-dialog";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const userId = "019d6e7d-0000-7000-8000-000000000002";
const personal = "019d6e7d-0000-7000-8000-000000000001";
const wedding = "019d6e7d-0000-7000-8000-000000000003";
const family = "019d6e7d-0000-7000-8000-000000000004";
const eventId = "019d6e7d-0000-7000-8000-000000000010";
const taskId = "019d6e7d-0000-7000-8000-000000000011";
const personId = "019d6e7d-0000-7000-8000-000000000012";
const relationId = "019d6e7d-0000-7000-8000-000000000013";
const guestId = "019d6e7d-0000-7000-8000-000000000014";
const memberId = "019d6e7d-0000-7000-8000-000000000015";

const workspaces = {
  personal: {
    id: personal,
    displayName: "Planner's workspace",
    personal: true,
    ownerDisplayName: "Planner",
    role: "owner",
  },
  wedding: {
    id: wedding,
    displayName: "Our wedding",
    personal: false,
    ownerDisplayName: "Planner",
    role: "owner",
  },
  family: {
    id: family,
    displayName: "Family",
    personal: false,
    ownerDisplayName: "Mei Lin",
    role: "viewer",
  },
} as const;

const session = {
  principal: { type: "user", userId, workspaceId: personal },
  user: {
    id: userId,
    displayName: "Planner",
    email: "planner@example.test",
    username: "planner",
    locale: null,
    timeZone: null,
    hourCycle: null,
    weekStart: null,
    rail: {},
    eventTabs: {},
  },
  workspace: { id: personal, displayName: "Planner's workspace" },
  availableWorkspaces: Object.values(workspaces),
} as unknown as SessionResponse;

const targets = {
  items: [
    {
      workspace: workspaces.personal,
      memberCount: 2,
      current: true,
      allowed: false,
    },
    {
      workspace: workspaces.wedding,
      memberCount: 3,
      current: false,
      allowed: true,
    },
    {
      workspace: workspaces.family,
      memberCount: 5,
      current: false,
      allowed: false,
    },
  ],
};

function preview(links: number) {
  const counts = {
    scheduleItems: 1,
    todos: 9,
    subtasks: 2,
    expenses: 3,
    reminders: 0,
    notes: 2,
    files: 4,
    sections: 1,
    pages: 2,
    inTrash: 0,
    shares: 1,
    pendingShares: 0,
  };
  return {
    eventId,
    from: workspaces.personal,
    to: workspaces.wedding,
    moves: counts,
    droppedLinks: {
      items: [
        {
          relationId,
          relationType: "includes",
          scoped: {
            id: eventId,
            objectType: "event",
            displayName: "Garden wedding",
          },
          other: { id: personId, objectType: "person", displayName: "Mei Lin" },
        },
      ],
      total: links - 1,
    },
    unassignedTasks: {
      items: [
        {
          taskId,
          displayName: "Book the photographer",
          person: { id: personId, displayName: "Mei Lin" },
        },
      ],
      total: 1,
    },
    labels: { items: [{ name: "Venue", existing: true }], total: 1 },
    peopleKept: { items: [], total: 0 },
    clearedLinks: 0,
    access: {
      targetMembers: { owner: 2, editor: 1, viewer: 0 },
      keepingShares: {
        items: [{ userId: guestId, displayName: "Ana Souza", role: "viewer" }],
        total: 1,
      },
      droppedGrants: { items: [], total: 0 },
      losingAccess: {
        items: [{ userId: memberId, displayName: "Chen Li" }],
        total: 1,
      },
      lapsingShares: 0,
    },
    expectedDroppedLinks: links,
  };
}

function eventRow() {
  return {
    id: eventId,
    workspaceId: wedding,
    objectType: "event",
    displayName: "Garden wedding",
    createdBy: userId,
    permissionScopeId: eventId,
    createdAt: "2026-09-02T20:00:00.000Z",
    updatedAt: "2026-09-02T20:00:00.000Z",
    version: 3,
    archivedAt: null,
    deletedAt: null,
    customProperties: {},
    metadata: {},
    startsAt: null,
    endsAt: null,
    timezone: null,
    startsOn: "2026-10-11",
    endsOn: "2026-10-11",
    isAllDay: true,
    location: null,
    description: null,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

interface Server {
  readonly previews: number[];
  readonly moves: unknown[];
  moveResponse: (count: number) => Response;
}

function serve(firstLinks: number, laterLinks = firstLinks): Server {
  const server: Server = {
    previews: [],
    moves: [],
    moveResponse: (count) =>
      json({
        event: eventRow(),
        move: {
          commandId: null,
          from: { id: personal, displayName: "Planner's workspace" },
          to: { id: wedding, displayName: "Our wedding" },
          moves: preview(count).moves,
          droppedLinks: count - 1,
          unassignedTasks: 1,
          clearedLinks: 0,
          labelsJoined: 1,
          labelsCreated: 0,
          grantsDropped: 0,
          peopleKept: 0,
          movedAt: "2026-09-26T08:00:00.000Z",
        },
      }),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL
          ? input.toString()
          : input.url,
        "http://localhost",
      );
      if (url.pathname === "/api/auth/session") return json(session);
      if (url.pathname === `/api/objects/${eventId}/move/targets`)
        return json(targets);
      if (url.pathname === `/api/objects/${eventId}/move`) {
        if (init?.method === "POST") {
          server.moves.push(JSON.parse(String(init.body)));
          return server.moveResponse(laterLinks);
        }
        const links = server.previews.length === 0 ? firstLinks : laterLinks;
        server.previews.push(links);
        return json(preview(links));
      }
      return json({});
    }),
  );
  return server;
}

function renderDialog() {
  const onClose = vi.fn();
  render(
    <Providers>
      <MoveToSpaceDialog
        event={{ id: eventId, displayName: "Garden wedding" }}
        session={session}
        onClose={onClose}
      />
    </Providers>,
  );
  return onClose;
}

describe("MoveToSpaceDialog", () => {
  beforeEach(() => {
    for (const method of ["showModal", "close"] as const) {
      Object.defineProperty(HTMLDialogElement.prototype, method, {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.toggleAttribute("open", method === "showModal");
        },
      });
    }
    window.sessionStorage.setItem(
      "chronelle.session",
      JSON.stringify({
        accessToken: "test-session",
        workspaceId: personal,
        homeWorkspaceId: personal,
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
    router.replace.mockClear();
  });

  it("lists the spaces: the current one and a Viewer's are not choices, the first allowed one is chosen", async () => {
    serve(2);
    renderDialog();
    const spaces = await screen.findByRole("radiogroup", { name: "Spaces" });
    const personalRow = within(spaces).getByRole("radio", {
      name: /Personal/,
    });
    expect(personalRow).toBeDisabled();
    expect(within(spaces).getByText("Here now")).toBeVisible();
    expect(
      within(spaces).getByRole("radio", { name: /Family/ }),
    ).toBeDisabled();
    expect(within(spaces).getByText("You can't add here")).toBeVisible();
    expect(
      within(spaces).getByRole("radio", { name: /Our wedding/ }),
    ).toBeChecked();
    expect(within(spaces).getByText("Owner · 3 members")).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("reviews what moves, the links it removes, and who can see it, then moves and opens the new space with a notice", async () => {
    const user = userEvent.setup();
    const server = serve(2);
    renderDialog();
    await user.click(await screen.findByRole("button", { name: "Continue" }));

    expect(
      await screen.findByRole("heading", { name: "Move to Our wedding" }),
    ).toBeVisible();
    const moves = screen.getByRole("region", { name: "Moves with it" });
    expect(moves).toHaveTextContent("9 to-dos");
    expect(moves).toHaveTextContent("2 subtasks");
    expect(moves).toHaveTextContent("Its pages, sections, and history");
    expect(moves).not.toHaveTextContent("reminder");
    const removed = screen.getByRole("region", {
      name: "Links the move removes",
    });
    expect(removed).toHaveTextContent(
      "These stay in Personal, so their links to what moves are removed.",
    );
    expect(removed).toHaveTextContent(
      "Mei Lin (Person), linked to Garden wedding",
    );
    expect(removed).toHaveTextContent(
      "Book the photographer is no longer assigned to Mei Lin",
    );
    expect(
      screen.getByRole("region", { name: "Stays behind" }),
    ).toHaveTextContent("The label Venue joins Our wedding's Venue");
    const after = screen.getByRole("region", { name: "Who can see it after" });
    expect(after).toHaveTextContent("Our wedding's 3 members, by their roles");
    expect(after).toHaveTextContent("Ana Souza keeps their share as Viewer");
    expect(after).toHaveTextContent(
      "Chen Li, a member of Personal, loses access",
    );

    await user.click(
      screen.getByRole("button", { name: "Move and remove 2 links" }),
    );
    expect(server.moves).toEqual([
      {
        workspaceId: wedding,
        expectedDroppedLinks: 2,
        commandId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    ]);
    expect(
      await screen.findByText(
        "Moved Garden wedding to Our wedding. Removed 2 links.",
      ),
    ).toBeVisible();
    expect(
      JSON.parse(window.sessionStorage.getItem("chronelle.session") ?? "{}")
        .workspaceId,
    ).toBe(wedding);

    await user.click(screen.getByRole("button", { name: "Open Personal" }));
    expect(
      JSON.parse(window.sessionStorage.getItem("chronelle.session") ?? "{}")
        .workspaceId,
    ).toBe(personal);
    expect(router.replace).toHaveBeenCalledWith("/events");
  });

  it("names the plain move when it removes no links", async () => {
    const user = userEvent.setup();
    const server = serve(0);
    server.moveResponse = () =>
      json({
        event: eventRow(),
        move: {
          commandId: null,
          from: { id: personal, displayName: "Planner's workspace" },
          to: { id: wedding, displayName: "Our wedding" },
          moves: preview(0).moves,
          droppedLinks: 0,
          unassignedTasks: 0,
          clearedLinks: 0,
          labelsJoined: 0,
          labelsCreated: 0,
          grantsDropped: 0,
          peopleKept: 0,
          movedAt: "2026-09-26T08:00:00.000Z",
        },
      });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url = new URL(
          typeof input === "string" || input instanceof URL
            ? input.toString()
            : input.url,
          "http://localhost",
        );
        if (url.pathname === `/api/objects/${eventId}/move/targets`)
          return json(targets);
        if (url.pathname === `/api/objects/${eventId}/move`) {
          if (init?.method === "POST") return server.moveResponse(0);
          const reviewed = preview(0);
          return json({
            ...reviewed,
            droppedLinks: { items: [], total: 0 },
            unassignedTasks: { items: [], total: 0 },
          });
        }
        return json(session);
      }),
    );
    renderDialog();
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(
      await screen.findByRole("button", { name: "Move to Our wedding" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("region", { name: "Links the move removes" }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Move to Our wedding" }),
    );
    expect(
      await screen.findByText("Moved Garden wedding to Our wedding."),
    ).toBeVisible();
  });

  it("asks for a second review when the links changed, keeping the move's command id", async () => {
    const user = userEvent.setup();
    const server = serve(2, 3);
    let refusals = 1;
    server.moveResponse = (count) => {
      if (refusals > 0) {
        refusals -= 1;
        return json(
          {
            error: {
              code: "move_changed",
              message: "The move changed since it was previewed.",
            },
          },
          409,
        );
      }
      return json({
        event: eventRow(),
        move: {
          commandId: null,
          from: { id: personal, displayName: "Planner's workspace" },
          to: { id: wedding, displayName: "Our wedding" },
          moves: preview(count).moves,
          droppedLinks: count - 1,
          unassignedTasks: 1,
          clearedLinks: 0,
          labelsJoined: 1,
          labelsCreated: 0,
          grantsDropped: 0,
          peopleKept: 0,
          movedAt: "2026-09-26T08:00:00.000Z",
        },
      });
    };
    renderDialog();
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    await user.click(
      await screen.findByRole("button", { name: "Move and remove 2 links" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This changed since you reviewed it. Review it again.",
    );
    await user.click(
      await screen.findByRole("button", { name: "Move and remove 3 links" }),
    );
    expect(
      await screen.findByText(
        "Moved Garden wedding to Our wedding. Removed 3 links.",
      ),
    ).toBeVisible();
    expect(server.moves).toHaveLength(2);
    const [first, second] = server.moves as { commandId: string }[];
    expect(second?.commandId).toBe(first?.commandId);
    expect(server.moves[1]).toMatchObject({ expectedDroppedLinks: 3 });
  });

  it("says there is nowhere to move when every other space is out of reach", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = new URL(
          typeof input === "string" || input instanceof URL
            ? input.toString()
            : input.url,
          "http://localhost",
        );
        if (url.pathname === `/api/objects/${eventId}/move/targets`)
          return json({ items: [targets.items[0], targets.items[2]] });
        return json(session);
      }),
    );
    renderDialog();
    expect(
      await screen.findByText(
        "There is no other space where you can add it. Create a space from the space switcher first.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
});
