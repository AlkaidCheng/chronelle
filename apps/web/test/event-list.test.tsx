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
import { Providers } from "../app/providers";
import { EventList } from "../features/events/event-list";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const event = {
  id: "019d6e7d-0000-7000-8000-000000000010",
  workspaceId,
  createdBy: workspaceId,
  permissionScopeId: "019d6e7d-0000-7000-8000-000000000010",
  objectType: "event",
  displayName: "Garden gathering",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  version: 1,
  archivedAt: null,
  deletedAt: null,
  customProperties: {},
  metadata: {},
  startsAt: null,
  endsAt: null,
  timezone: null,
  isAllDay: false,
};
const another = {
  ...event,
  id: "019d6e7d-0000-7000-8000-000000000011",
  displayName: "Another plan",
};
const own = { sharedBy: null, role: null, sharedWith: 0 };
const page = (items: (typeof event)[], nextCursor: string | null = null) =>
  Response.json({
    items: items.map((item) => ({ ...item, access: own })),
    nextCursor,
    asOf: "2026-09-07T00:00:00.000000Z",
  });

describe("EventList", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.stubGlobal("localStorage", { getItem: vi.fn(), setItem: vi.fn() });
    window.sessionStorage.setItem(
      "chronelle.session",
      JSON.stringify({ accessToken: "test-session", workspaceId }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("loads canonical pages, resets for server filters and refreshes from the first page", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(page([event], "next_page"))
      .mockResolvedValueOnce(
        page([{ ...event, displayName: "Updated gathering" }, another]),
      )
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([event]));
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(
      <Providers>
        <EventList />
      </Providers>,
    );
    await user.click(
      await screen.findByRole("button", { name: "Load more events" }),
    );
    expect(await screen.findByText("2 events loaded")).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Updated gathering/ }),
    ).toHaveAttribute("href", `/events/${event.id}`);
    expect(
      screen.queryByRole("link", { name: /Garden gathering/ }),
    ).not.toBeInTheDocument();
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "/api/events?query=&scope=all&filter=all&sort=date&cursor=next_page",
    );
    await user.click(screen.getByRole("button", { name: "Sort events" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Name A-Z" }));
    expect(await screen.findByText("No events yet")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Refresh events" }));
    expect(await screen.findByText("1 event loaded")).toBeVisible();
    expect(fetch.mock.calls.slice(2).map(([url]) => url)).toEqual(
      Array(2).fill("/api/events?query=&scope=all&filter=all&sort=name"),
    );
  });

  it("debounces name requests and distinguishes filtered empty results", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(page([event]))
      .mockImplementation(async () => page([]));
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(
      <Providers>
        <EventList />
      </Providers>,
    );
    await screen.findByText("Garden gathering");
    await user.type(screen.getByLabelText("Filter events by name"), "missing");
    expect(screen.queryByText("Garden gathering")).not.toBeInTheDocument();
    expect(await screen.findByText("No matching events")).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "/api/events?query=missing&scope=all&filter=all&sort=date",
    );
    await user.click(screen.getByRole("button", { name: "Filter events" }));
    await user.click(
      screen.getByRole("menuitemradio", { name: "Upcoming & ongoing" }),
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch.mock.calls[2]?.[0]).toBe(
      "/api/events?query=missing&scope=all&filter=upcoming&sort=date",
    );
  });

  it("keeps loaded cards while retrying a failed continuation", async () => {
    const error = () =>
      Response.json(
        {
          error: {
            code: "internal_error",
            message: "Events unavailable",
            requestId: "test",
          },
        },
        { status: 500 },
      );
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(page([event], "next_page"))
      .mockImplementationOnce(async () => error())
      .mockImplementationOnce(async () => error())
      .mockResolvedValueOnce(page([another]));
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(
      <Providers>
        <EventList />
      </Providers>,
    );
    await user.click(
      await screen.findByRole("button", { name: "Load more events" }),
    );
    expect(
      await screen.findByRole("alert", {}, { timeout: 3000 }),
    ).toBeVisible();
    expect(screen.getByText("Garden gathering")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("2 events loaded")).toBeVisible();
    expect(fetch.mock.calls.slice(1).map(([url]) => url)).toEqual(
      Array(3).fill(
        "/api/events?query=&scope=all&filter=all&sort=date&cursor=next_page",
      ),
    );
  });

  it("retains private filters and loaded pages across a collection remount", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (url) =>
        String(url).includes("cursor=")
          ? page([another])
          : page([event], "next_page"),
      );
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    const view = render(
      <Providers>
        <EventList />
      </Providers>,
    );
    await screen.findByText("Garden gathering");
    await user.type(screen.getByLabelText("Filter events by name"), "Garden");
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "Sort events" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Name A-Z" }));
    await user.click(screen.getByRole("button", { name: "Filter events" }));
    await user.click(
      screen.getByRole("menuitemradio", { name: "Unscheduled" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Load more events" }),
    );
    await screen.findByText("2 events loaded");
    const requests = fetch.mock.calls.length;
    view.rerender(<Providers>{null}</Providers>);
    view.rerender(
      <Providers>
        <EventList />
      </Providers>,
    );
    expect(screen.getByLabelText("Filter events by name")).toHaveValue(
      "Garden",
    );
    expect(screen.getByRole("button", { name: "Sort events" })).toHaveAttribute(
      "data-value",
      "name",
    );
    expect(
      screen.getByRole("button", { name: "Filter events" }),
    ).toHaveAttribute("data-value", "unscheduled");
    expect(screen.getByText("2 events loaded")).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(requests);
    expect(window.location.href).not.toContain("Garden");
    expect(JSON.stringify(window.sessionStorage)).not.toContain("Garden");
  });

  it("waits for committed composition text before sending a name request", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => page([]));
    vi.stubGlobal("fetch", fetch);
    render(
      <Providers>
        <EventList />
      </Providers>,
    );
    await screen.findByText("No events yet");
    const input = screen.getByLabelText("Filter events by name");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "zhong" } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: "\u4e2d\u79cb" } });
    fireEvent.compositionEnd(input);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(
      new URL(
        String(fetch.mock.calls[1]?.[0]),
        "http://example.test",
      ).searchParams.get("query"),
    ).toBe("\u4e2d\u79cb");
  });
});
