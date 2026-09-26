// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { NewSpaceDialog } from "../features/spaces/new-space-dialog";

const home = "019d6e7d-0000-7000-8000-000000000001";
const created = "019d6e7d-0000-7000-8000-000000000009";
const userId = "019d6e7d-0000-7000-8000-000000000002";
const ben = {
  id: "019d6e7d-0000-7000-8000-000000000011",
  userId: "019d6e7d-0000-7000-8000-000000000012",
  displayName: "Ben Okafor",
  email: "ben@example.com",
  since: "2026-09-01T09:00:00.000Z",
};
const mei = {
  id: "019d6e7d-0000-7000-8000-000000000013",
  userId: "019d6e7d-0000-7000-8000-000000000014",
  displayName: "Mei Lin",
  email: null,
  since: "2026-09-01T09:00:00.000Z",
};
const space = {
  id: created,
  displayName: "Our wedding",
  personal: false,
  ownerDisplayName: "Planner",
  role: "owner",
};

const session = {
  principal: { type: "user", userId, workspaceId: home },
  user: {
    id: userId,
    displayName: "Planner",
    email: "planner@example.com",
    username: "planner",
    findByName: true,
    findByEmail: true,
    onboardedAt: "2026-09-01T09:00:00.000Z",
    locale: null,
    timeZone: null,
    hourCycle: null,
    weekStart: null,
    rail: {},
    eventTabs: {},
    workspaceRecency: {},
  },
  workspace: { id: home, displayName: "Planner's workspace" },
  availableWorkspaces: [
    {
      id: home,
      displayName: "Planner's workspace",
      personal: true,
      ownerDisplayName: "Planner",
      role: "owner",
    },
  ],
};

/** Answers the routes the dialog uses and records each write with the space it names. */
function stubApi(failMember?: string) {
  const writes: { url: string; workspace: string | null; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/auth/session") return Response.json(session);
      if (url === "/api/friends")
        return Response.json({ friends: [ben, mei], incoming: [], sent: [] });
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      writes.push({
        url: `${method} ${url}`,
        workspace: new Headers(init?.headers).get("x-workspace-id"),
        body,
      });
      if (url === "/api/workspaces")
        return Response.json(space, { status: 201 });
      if (url === "/api/workspaces/current/members") {
        const friend = body.friendId === ben.id ? ben : mei;
        if (friend.id === failMember)
          return Response.json(
            { error: { code: "friend_unavailable", message: "Gone." } },
            { status: 404 },
          );
        return Response.json(
          {
            userId: friend.userId,
            displayName: friend.displayName,
            email: friend.email,
            role: body.role,
            personal: false,
            friendId: friend.id,
            joinedAt: "2026-09-26T00:00:00.000Z",
          },
          { status: 201 },
        );
      }
      return Response.json({}, { status: 404 });
    }),
  );
  return writes;
}

describe("New space", () => {
  beforeEach(() => {
    window.sessionStorage.setItem(
      "chronelle.session",
      JSON.stringify({ accessToken: "test-session", workspaceId: home }),
    );
    for (const method of ["showModal", "close"] as const) {
      Object.defineProperty(HTMLDialogElement.prototype, method, {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.toggleAttribute("open", method === "showModal");
        },
      });
    }
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("creates the space with the account as Owner and adds each chosen friend in it", async () => {
    const writes = stubApi();
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<NewSpaceDialog onClose={() => undefined} onCreated={onCreated} />, {
      wrapper: Providers,
    });
    const create = screen.getByRole("button", { name: "Create space" });
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText("Name"), "Our wedding");
    const add = await screen.findByRole("combobox", { name: "Add a friend" });
    await user.selectOptions(add, ben.id);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Add a friend" }),
      mei.id,
    );
    // The creator is the Owner; friends join as Editors unless changed.
    expect(screen.getByRole("list", { name: "Members" })).toHaveTextContent(
      "PlannerYouOwner",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Role for Ben Okafor" }),
      "owner",
    );
    await user.click(create);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(space, 0));
    expect(writes).toEqual([
      {
        url: "POST /api/workspaces",
        workspace: home,
        body: { displayName: "Our wedding" },
      },
      {
        url: "POST /api/workspaces/current/members",
        workspace: created,
        body: { friendId: ben.id, role: "owner" },
      },
      {
        url: "POST /api/workspaces/current/members",
        workspace: created,
        body: { friendId: mei.id, role: "editor" },
      },
    ]);
  });

  it("keeps the space when a friend cannot be added, and counts them", async () => {
    stubApi(mei.id);
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<NewSpaceDialog onClose={() => undefined} onCreated={onCreated} />, {
      wrapper: Providers,
    });
    await user.type(screen.getByLabelText("Name"), "Our wedding");
    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Add a friend" }),
      mei.id,
    );
    await user.click(screen.getByRole("button", { name: "Create space" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(space, 1));
  });
});
