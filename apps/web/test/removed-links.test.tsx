// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Providers } from "../app/providers";
import { RemovedLinksPanel } from "../features/recovery/removed-links-panel";

const id = "019d6e7d-0000-7000-8000-000000000001";
const workspaceId = "019d6e7d-0000-7000-8000-000000000002";
function item(index: number) {
  return {
    relation: {
      id: `019d6e7d-0000-7000-8000-${String(index).padStart(12, "0")}`,
      workspaceId,
      sourceObjectId: id,
      targetObjectId: workspaceId,
      relationType: "includes",
      version: 2,
      createdBy: id,
      createdAt: "2026-09-02T20:00:00.000Z",
      deletedAt: "2026-09-03T20:00:00.000Z",
      metadata: {},
    },
    sourceDisplayName: "Workshop",
    targetDisplayName: `Task ${index}`,
  };
}
let fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
beforeEach(() => {
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({ accessToken: "test-session", workspaceId }),
  );
  fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ items: [], nextCursor: null }),
  );
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});
function open() {
  render(
    <Providers>
      <RemovedLinksPanel objectId={id} />
    </Providers>,
  );
  return userEvent.setup();
}

it("loads cursor pages, deduplicates links and starts filters at the first page", async () => {
  fetch.mockImplementation(async (input) => {
    const url = new URL(String(input), "http://localhost");
    if (url.searchParams.has("relationType"))
      return Response.json({ items: [item(3)], nextCursor: null });
    return Response.json(
      url.searchParams.has("cursor")
        ? { items: [item(1), item(2)], nextCursor: null }
        : { items: [item(1)], nextCursor: "second_page" },
    );
  });
  const user = open();
  await screen.findByText("Workshop → Task 1");
  await user.click(
    screen.getByRole("button", { name: "Load more removed links" }),
  );
  await screen.findByText("Workshop → Task 2");
  expect(screen.getAllByText("Workshop → Task 1")).toHaveLength(1);
  expect(
    fetch.mock.calls.some(([url]) =>
      String(url).includes("cursor=second_page"),
    ),
  ).toBe(true);
  await user.selectOptions(screen.getByLabelText("Link type"), "includes");
  await screen.findByText("Workshop → Task 3");
  expect(screen.queryByText("Workshop → Task 1")).toBeNull();
  const filtered = fetch.mock.calls.filter(([url]) =>
    String(url).includes("relationType=includes"),
  );
  expect(filtered.length).toBeGreaterThan(0);
  expect(filtered.every(([url]) => !String(url).includes("cursor="))).toBe(
    true,
  );
  await user.selectOptions(screen.getByLabelText("Link type"), "");
  await screen.findByText("Workshop → Task 1");
  expect(screen.queryByText("Workshop → Task 2")).toBeNull();
});

it("cancels an abandoned filtered page and ignores its late response", async () => {
  let resolvePage: ((value: Response) => void) | undefined;
  let pendingSignal: AbortSignal | null | undefined;
  fetch.mockImplementation(async (input, options) => {
    const url = new URL(String(input), "http://localhost");
    if (url.searchParams.has("cursor")) {
      pendingSignal = options?.signal;
      return new Promise<Response>((resolve) => {
        resolvePage = resolve;
      });
    }
    return Response.json(
      url.searchParams.has("relationType")
        ? { items: [item(3)], nextCursor: null }
        : { items: [item(1)], nextCursor: "second_page" },
    );
  });
  const user = open();
  await screen.findByText("Workshop → Task 1");
  await user.click(
    screen.getByRole("button", { name: "Load more removed links" }),
  );
  await waitFor(() => expect(resolvePage).toBeDefined());
  await user.selectOptions(screen.getByLabelText("Link type"), "related_to");
  await screen.findByText("Workshop → Task 3");
  expect(pendingSignal?.aborted).toBe(true);
  await act(async () => {
    resolvePage?.(Response.json({ items: [item(2)], nextCursor: null }));
  });
  await waitFor(() =>
    expect(screen.queryByText("Workshop → Task 2")).toBeNull(),
  );
});

it("keeps loaded links visible when continuation fails and can refresh", async () => {
  fetch.mockImplementation(async (input) => {
    if (String(input).includes("cursor="))
      return Response.json(
        { error: { code: "unavailable", message: "Try again." } },
        { status: 503 },
      );
    return Response.json({ items: [item(1)], nextCursor: "second_page" });
  });
  const user = open();
  await screen.findByText("Workshop → Task 1");
  await user.click(
    screen.getByRole("button", { name: "Load more removed links" }),
  );
  await screen.findByRole("alert", {}, { timeout: 3000 });
  expect(screen.getByText("Workshop → Task 1")).toBeVisible();
  fetch.mockImplementation(async () =>
    Response.json({ items: [], nextCursor: null }),
  );
  await user.click(screen.getByRole("button", { name: "Refresh links" }));
  await screen.findByText("No recoverable links");
});
