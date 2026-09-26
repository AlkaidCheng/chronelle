// @vitest-environment jsdom

import type { SessionResponse } from "@livtales/schemas";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { SpaceDeleteSection } from "../features/spaces/space-sections";

const userId = "019d6e7d-0000-7000-8000-000000000002";
const personal = "019d6e7d-0000-7000-8000-000000000001";
const trip = "019d6e7d-0000-7000-8000-000000000003";

function sessionIn(
  workspace: "personal" | "trip",
  role: "owner" | "editor" = "owner",
): SessionResponse {
  const spaces = [
    {
      id: personal,
      displayName: "Planner's workspace",
      personal: true,
      ownerDisplayName: "Planner",
      role: "owner",
    },
    {
      id: trip,
      displayName: "Old trip",
      personal: false,
      ownerDisplayName: "Planner",
      role,
    },
  ];
  const current = workspace === "personal" ? spaces[0] : spaces[1];
  return {
    principal: { type: "user", userId, workspaceId: current?.id },
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
    workspace: { id: current?.id, displayName: current?.displayName },
    availableWorkspaces: spaces,
  } as unknown as SessionResponse;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function serve(
  previews: readonly unknown[],
  deleteResponse: () => Response = () => new Response(null, { status: 204 }),
) {
  const calls = { previews: 0, deletes: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL
          ? input.toString()
          : input.url,
        "http://localhost",
      );
      if (url.pathname === "/api/workspaces/current/deletion") {
        const preview = previews[Math.min(calls.previews, previews.length - 1)];
        calls.previews += 1;
        return json(preview);
      }
      if (
        url.pathname === "/api/workspaces/current" &&
        init?.method === "DELETE"
      ) {
        calls.deletes += 1;
        return deleteResponse();
      }
      return json({});
    }),
  );
  return calls;
}

const empty = {
  deletable: true,
  reason: null,
  liveRecords: 0,
  trashRecords: 3,
  memberCount: 2,
};
const holding = {
  deletable: false,
  reason: "holds_records",
  liveRecords: 2,
  trashRecords: 1,
  memberCount: 2,
};

describe("SpaceDeleteSection", () => {
  beforeEach(() => {
    window.sessionStorage.setItem(
      "chronelle.session",
      JSON.stringify({
        accessToken: "test-session",
        workspaceId: trip,
        homeWorkspaceId: personal,
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it.each([
    ["a Personal space", sessionIn("personal")],
    ["an Editor", sessionIn("trip", "editor")],
  ])("offers nothing in %s", async (_case, session) => {
    const calls = serve([empty]);
    render(
      <Providers>
        <SpaceDeleteSection session={session} onDeleted={vi.fn()} />
      </Providers>,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("button", { name: "Delete space" })).toBeNull();
    expect(calls.previews).toBe(0);
  });

  it("says how many records keep the space from being deleted", async () => {
    serve([holding]);
    render(
      <Providers>
        <SpaceDeleteSection session={sessionIn("trip")} onDeleted={vi.fn()} />
      </Providers>,
    );
    expect(
      await screen.findByText(
        "It still holds 2 records. Move them to another space or to Trash first.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete space" })).toBeDisabled();
  });

  it("deletes a space that holds nothing but Trash after a confirmation, then opens another with a notice", async () => {
    const user = userEvent.setup();
    const calls = serve([empty]);
    const onDeleted = vi.fn();
    render(
      <Providers>
        <SpaceDeleteSection session={sessionIn("trip")} onDeleted={onDeleted} />
      </Providers>,
    );
    expect(
      await screen.findByText(
        "Every member loses access, and the 3 records in its Trash go with it. This can't be undone.",
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Delete space" }));
    expect(screen.getByText("Delete Old trip for everyone?")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Delete space" }));
    await vi.waitFor(() =>
      expect(onDeleted).toHaveBeenCalledWith({ message: "Deleted Old trip" }),
    );
    expect(calls.deletes).toBe(1);
  });

  it("checks again when a record arrived before the deletion", async () => {
    const user = userEvent.setup();
    const calls = serve([empty, holding], () =>
      json(
        {
          error: {
            code: "space_not_empty",
            message: "The space still holds records.",
          },
        },
        409,
      ),
    );
    const onDeleted = vi.fn();
    render(
      <Providers>
        <SpaceDeleteSection session={sessionIn("trip")} onDeleted={onDeleted} />
      </Providers>,
    );
    await user.click(
      await screen.findByRole("button", { name: "Delete space" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete space" }));
    expect(
      await screen.findByText(
        "It still holds 2 records. Move them to another space or to Trash first.",
      ),
    ).toBeVisible();
    expect(calls.previews).toBe(2);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
