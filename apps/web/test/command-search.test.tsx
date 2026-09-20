// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useQueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Providers } from "../app/providers";
import { SearchEntry } from "../components/search-entry";
import { useAuthSession } from "../lib/auth-session";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/events",
}));
const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const eventId = "019d6e7d-0000-7000-8000-000000000010";
const record = {
  id: eventId,
  displayName: "Autumn gathering",
  objectType: "event",
  permissionScopeId: eventId,
  version: 1,
  updatedAt: "2026-09-04T20:00:00.000Z",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const response = () => json({ items: [record], nextCursor: null });
const fetch = vi.fn<typeof globalThis.fetch>();
const input = () =>
  screen.getByRole("combobox", { name: "Search records and commands" });
const options = () => within(screen.getByRole("listbox", { name: "Commands" }));
const change = (query: string) =>
  fireEvent.change(input(), { target: { value: query } });
const open = () => {
  const trigger = screen.getAllByRole("button", {
    name: "Search and commands",
  })[0];
  if (!trigger) throw new Error("Search trigger missing");
  fireEvent.click(trigger);
};
const close = () =>
  fireEvent.click(screen.getByRole("button", { name: "Close search" }));
const methods = ["showModal", "close"] as const;
const descriptors = methods.map((method) =>
  Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method),
);

function Harness() {
  const auth = useAuthSession();
  const queries = useQueryClient();
  return (
    <>
      <nav className="workspace-nav">
        <SearchEntry />
      </nav>
      <button
        type="button"
        onClick={() => void queries.invalidateQueries({ queryKey: ["search"] })}
      >
        Invalidate records
      </button>
      <button type="button" onClick={auth.signOut}>
        Expire session
      </button>
      <button
        type="button"
        onClick={() =>
          auth.switchWorkspace("019d6e7d-0000-7000-8000-000000000002")
        }
      >
        Switch workspace
      </button>
      <button
        type="button"
        onClick={() =>
          auth.startSession({ accessToken: "replacement", workspaceId })
        }
      >
        Replace identity
      </button>
      <div id="workspace-content" tabIndex={-1} />
    </>
  );
}
function setup() {
  render(
    <Providers>
      <Harness />
    </Providers>,
  );
  open();
}

beforeEach(() => {
  push.mockReset();
  fetch.mockReset().mockImplementation(async () => response());
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("localStorage", window.sessionStorage);
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({ accessToken: "test-session", workspaceId }),
  );
  for (const method of methods)
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.toggleAttribute("open", method === "showModal");
      },
    });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  methods.forEach((method, index) => {
    const descriptor = descriptors[index];
    if (descriptor)
      Object.defineProperty(HTMLDialogElement.prototype, method, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
  });
});

it("debounces valid terms and pauses during composition", async () => {
  vi.useFakeTimers();
  setup();
  for (const term of ["", "a", "  ", "!!"]) {
    change(term);
    await act(() => vi.advanceTimersByTimeAsync(300));
  }
  expect(fetch).not.toHaveBeenCalled();
  change("au");
  await act(() => vi.advanceTimersByTimeAsync(200));
  change("autumn");
  await act(() => vi.advanceTimersByTimeAsync(249));
  expect(fetch).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[0]).toBe("/api/search?query=autumn&limit=8");
  fireEvent.compositionStart(input());
  change("\u79cb\u5929");
  await act(() => vi.advanceTimersByTimeAsync(400));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("group", { name: "Records" }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
  expect(push).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input());
  await act(() => vi.advanceTimersByTimeAsync(250));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(String(fetch.mock.calls[1]?.[0])).toContain(
    "query=%E7%A7%8B%E5%A4%A9",
  );
});

it("opens the canonical destination without persisting query text or showing IDs", async () => {
  setup();
  change("autumn");
  const option = await screen.findByRole("option", {
    name: /Autumn gathering/,
  });
  await waitFor(() => expect(option).toHaveAttribute("aria-selected", "true"));
  expect(input()).toHaveAttribute("aria-activedescendant", option.id);
  expect(option).toHaveTextContent("Event / Open event");
  expect(option).not.toHaveTextContent(eventId);
  const headers = fetch.mock.calls[0]?.[1]?.headers as Headers;
  expect(headers.get("x-workspace-id")).toBe(workspaceId);
  // The session travels as the origin's cookie, never as a header the page sets.
  expect(headers.get("authorization")).toBeNull();
  fireEvent.keyDown(input(), { key: "Enter" });
  expect(push).toHaveBeenCalledExactlyOnceWith(`/events/${eventId}`);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key !== null) expect(storage.getItem(key)).not.toContain("autumn");
    }
  }
});

it("does not steal navigation selection when records arrive", async () => {
  setup();
  change("search");
  await screen.findByRole("option", { name: /Autumn gathering/ });
  expect(options().getByRole("option", { selected: true })).toHaveTextContent(
    "Search",
  );
  fireEvent.keyDown(input(), { key: "Enter" });
  expect(push).toHaveBeenCalledExactlyOnceWith("/search");
});

it("shows unavailable destinations without inventing routes", async () => {
  fetch.mockImplementation(async () =>
    json({ items: [{ ...record, objectType: "task" }], nextCursor: null }),
  );
  setup();
  change("autumn");
  const option = await screen.findByRole("option", {
    name: /Autumn gathering/,
  });
  expect(option).toHaveAttribute("aria-disabled", "true");
  expect(option).toHaveTextContent("Detail page unavailable");
  fireEvent.click(option);
  fireEvent.keyDown(input(), { key: "Enter" });
  expect(push).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeVisible();
});

it("bounds records and leaves a full-search destination", async () => {
  fetch.mockImplementation(async () =>
    json({
      items: Array.from({ length: 10 }, (_, index) => ({
        ...record,
        id: `019d6e7d-0000-7000-8000-0000000000${20 + index}`,
        displayName: `Autumn ${index}`,
      })),
      nextCursor: "next_page",
    }),
  );
  setup();
  change("autumn");
  await screen.findByRole("group", { name: "Records" });
  expect(options().getAllByRole("option")).toHaveLength(8);
  expect(screen.getByText(/Showing eight records/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Open full Search" }));
  expect(push).toHaveBeenCalledExactlyOnceWith("/search");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("aborts superseded requests and ignores responses delivered out of order", async () => {
  let finish: (value: Response) => void = () => {
    throw new Error("Missing request");
  };
  fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  setup();
  change("autumn");
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const signal = fetch.mock.calls[0]?.[1]?.signal;
  change("winter");
  expect(
    screen.queryByRole("group", { name: "Records" }),
  ).not.toBeInTheDocument();
  await waitFor(() => expect(signal?.aborted).toBe(true));
  fetch.mockImplementation(async () =>
    json({
      items: [{ ...record, displayName: "Winter gathering" }],
      nextCursor: null,
    }),
  );
  await screen.findByRole("option", { name: /Winter gathering/ });
  await act(async () => finish(response()));
  expect(
    screen.queryByRole("option", { name: /Autumn gathering/ }),
  ).not.toBeInTheDocument();
});

it("hides loaded records immediately on changed input and refreshes on reopen", async () => {
  setup();
  change("autumn");
  await screen.findByRole("option", { name: /Autumn gathering/ });
  change("winter");
  expect(
    screen.queryByRole("group", { name: "Records" }),
  ).not.toBeInTheDocument();
  close();
  fetch.mockImplementation(async () => json({ items: [], nextCursor: null }));
  open();
  expect(input()).toHaveValue("");
  change("autumn");
  expect(
    screen.queryByRole("group", { name: "Records" }),
  ).not.toBeInTheDocument();
  await screen.findByText("No accessible records found. Try another phrase.");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([403, 404, 429, 503])(
  "removes failed results after revalidation (%s), without replacing the selection",
  async (status) => {
    setup();
    change("autumn");
    const option = await screen.findByRole("option", {
      name: /Autumn gathering/,
    });
    await waitFor(() =>
      expect(option).toHaveAttribute("aria-selected", "true"),
    );
    fetch.mockImplementation(async () =>
      json(
        {
          error: {
            code: "unavailable",
            message: "Unavailable",
            requestId: "test",
          },
        },
        status,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Invalidate records" }));
    await screen.findByRole("alert");
    expect(
      screen.queryByRole("group", { name: "Records" }),
    ).not.toBeInTheDocument();
    expect(input()).not.toHaveAttribute("aria-activedescendant");
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockImplementation(async () =>
      json({
        items: [
          {
            ...record,
            id: "019d6e7d-0000-7000-8000-000000000099",
            displayName: "Autumn alternative",
          },
        ],
        nextCursor: null,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Retry record search" }),
    );
    await screen.findByRole("option", { name: /Autumn alternative/ });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(push).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(push).toHaveBeenCalledExactlyOnceWith(`/events/${eventId}`);
  },
);

it.each([
  "Expire session",
  "Switch workspace",
  "Replace identity",
  "Close search",
])(
  "aborts a pending request on %s and cannot revive its records",
  async (action) => {
    let finish: (value: Response) => void = () => {
      throw new Error("Missing request");
    };
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    setup();
    change("autumn");
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const signal = fetch.mock.calls[0]?.[1]?.signal;
    fireEvent.click(screen.getByRole("button", { name: action }));
    await waitFor(() => expect(signal?.aborted).toBe(true));
    await act(async () => finish(response()));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Autumn gathering")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  },
);
