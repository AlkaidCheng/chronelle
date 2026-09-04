// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { ObjectSearch } from "../features/search/object-search";

const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const eventId = "019d6e7d-0000-7000-8000-000000000010";
const taskId = "019d6e7d-0000-7000-8000-000000000011";

describe("ObjectSearch", () => {
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

  it("submits typed filters and links inherited objects to their Event", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: taskId,
              displayName: "Confirm launch venue",
              objectType: "task",
              permissionScopeId: eventId,
              updatedAt: "2026-09-04T20:00:00.000Z",
              version: 1,
            },
          ],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();

    render(
      <Providers>
        <ObjectSearch />
      </Providers>,
    );

    await user.type(screen.getByLabelText("Keywords"), "launch venue");
    await user.selectOptions(screen.getByLabelText("Type"), "task");
    await user.click(screen.getByRole("button", { name: "Search" }));

    const result = await screen.findByRole("link", {
      name: /Confirm launch venue/,
    });
    expect(result).toHaveAttribute("href", `/events/${eventId}`);
    expect(fetch).toHaveBeenCalledWith(
      "/api/search?query=launch+venue&objectType=task",
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
  });
});
