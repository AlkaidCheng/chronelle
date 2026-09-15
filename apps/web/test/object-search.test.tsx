// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { ObjectSearch } from "../features/search/object-search";

const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const eventId = "019d6e7d-0000-7000-8000-000000000010";
const taskId = "019d6e7d-0000-7000-8000-000000000011";
const task = {
  id: taskId,
  displayName: "Confirm launch venue",
  objectType: "task",
  permissionScopeId: eventId,
  updatedAt: "2026-09-04T20:00:00.000Z",
  version: 1,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });

describe("ObjectSearch", () => {
  beforeEach(() => {
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

  it("submits typed filters and links inherited objects to their Event", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json({ nextCursor: null, items: [task] }));
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

  it("appends pages, deduplicates canonical IDs, and resets pagination for new filters", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ items: [task], nextCursor: "next_page" }))
      .mockResolvedValueOnce(
        json({
          items: [
            task,
            {
              ...task,
              id: eventId,
              displayName: "Launch event",
              objectType: "event",
            },
          ],
          nextCursor: null,
        }),
      )
      .mockResolvedValueOnce(json({ items: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(
      <Providers>
        <ObjectSearch />
      </Providers>,
    );
    await user.type(screen.getByLabelText("Keywords"), "launch");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(
      await screen.findByRole("button", { name: "Load more results" }),
    );
    expect(await screen.findByText("2 loaded")).toBeVisible();
    expect(
      screen.getAllByRole("link", { name: /Confirm launch venue/ }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Load more results" }),
    ).not.toBeInTheDocument();
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "/api/search?query=launch&cursor=next_page",
    );
    await user.selectOptions(screen.getByLabelText("Type"), "expense");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(
      await screen.findByText("No accessible objects found"),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Confirm launch venue/ }),
    ).not.toBeInTheDocument();
    expect(fetch.mock.calls[2]?.[0]).toBe(
      "/api/search?query=launch&objectType=expense",
    );
  });

  it("preserves loaded results and retries only the failed next page", async () => {
    const error = () =>
      json(
        {
          error: {
            code: "internal_error",
            message: "Search unavailable",
            requestId: "test-request",
          },
        },
        500,
      );
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ items: [task], nextCursor: "next_page" }))
      .mockImplementationOnce(async () => error())
      .mockImplementationOnce(async () => error())
      .mockResolvedValueOnce(
        json({
          items: [{ ...task, id: eventId, displayName: "Another launch" }],
          nextCursor: null,
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(
      <Providers>
        <ObjectSearch />
      </Providers>,
    );
    await user.type(screen.getByLabelText("Keywords"), "launch");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(
      await screen.findByRole("button", { name: "Load more results" }),
    );
    expect(
      await screen.findByRole("alert", {}, { timeout: 3000 }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Confirm launch venue/ }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("2 loaded")).toBeVisible();
    expect(fetch.mock.calls.slice(1).map(([url]) => url)).toEqual(
      Array(3).fill("/api/search?query=launch&cursor=next_page"),
    );
  });
});
