// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { FriendsPage } from "../features/friends/friends-page";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/friends",
}));

let store: SandboxStore;
let saved: string | null;
const requests: { method: string; path: string; body: unknown }[] = [];

beforeEach(() => {
  saved = null;
  store = new SandboxStore({
    getItem: () => saved,
    setItem: (_key, value) => {
      saved = value;
    },
  });
  requests.length = 0;
  vi.stubGlobal("localStorage", window.sessionStorage);
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({ accessToken: "sample", workspaceId: sandboxWorkspaceId }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>((input, options) => {
      requests.push({
        method: options?.method ?? "GET",
        path: new URL(String(input), "https://sandbox.invalid").pathname,
        body: options?.body ? JSON.parse(String(options.body)) : undefined,
      });
      return store.fetch(input, options);
    }),
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

const wrapper = ({ children }: { readonly children: ReactNode }) => (
  <Providers>{children}</Providers>
);

describe("the Friends page", () => {
  it("shows the requests, the friends, and what was sent, and answers a request", async () => {
    const user = userEvent.setup();
    render(<FriendsPage />, { wrapper });
    const requestsSection = await screen.findByRole("region", {
      name: /Requests/,
    });
    expect(requestsSection).toHaveTextContent("Tomas Berg");
    expect(requestsSection).toHaveTextContent("climbing gym");
    const friends = screen.getByRole("region", { name: /^Friends/ });
    expect(friends).toHaveTextContent("Mei Lin");
    expect(friends).toHaveTextContent("mei.lin@example.test");
    const sent = screen.getByRole("region", { name: /Sent/ });
    expect(sent).toHaveTextContent("priya@example.test");
    expect(sent).toHaveTextContent("Sign-up link valid until");

    await user.click(
      within(requestsSection).getByRole("button", { name: "Accept" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: /^Friends/ }),
      ).toHaveTextContent("Tomas Berg"),
    );
    expect(
      screen.queryByRole("region", { name: /Requests/ }),
    ).not.toBeInTheDocument();
    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/friends/requests/00000000-0000-4000-8000-0000000000f2/accept",
      body: undefined,
    });
  });

  it("invites someone new by email with a note and lists it under Sent", async () => {
    const user = userEvent.setup();
    render(<FriendsPage />, { wrapper });
    await user.click(
      await screen.findByRole("button", { name: "Invite a friend" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Invite a friend" });
    await user.type(within(dialog).getByLabelText("Email"), "dan@example.test");
    await user.type(
      within(dialog).getByLabelText("Note (optional)"),
      "Join us here.",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Send invitation" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole("region", { name: /Sent/ })).toHaveTextContent(
        "dan@example.test",
      ),
    );
    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/friends/invitations",
      body: { email: "dan@example.test", message: "Join us here." },
    });
    // Withdrawing takes it back out.
    const sent = screen.getByRole("region", { name: /Sent/ });
    const row = within(sent).getByText("dan@example.test").closest("li");
    if (row === null) throw new Error("no row");
    await user.click(
      within(row).getByRole("button", { name: "Withdraw invitation" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: /Sent/ }),
      ).not.toHaveTextContent("dan@example.test"),
    );
  });

  it("removes a friend", async () => {
    const user = userEvent.setup();
    render(<FriendsPage />, { wrapper });
    const friends = await screen.findByRole("region", { name: /^Friends/ });
    await user.click(
      within(friends).getByRole("button", { name: "Remove friend" }),
    );
    await user.click(
      within(friends).getByRole("button", { name: "Remove friend" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: /^Friends/ }),
      ).toHaveTextContent("No friends yet"),
    );
  });
});
