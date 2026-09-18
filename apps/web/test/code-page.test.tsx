// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { CodePage } from "../features/friends/code-page";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/u/meilin",
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

describe("the page a code opens", () => {
  it("names the account behind the code and how the two stand, and sends a request", async () => {
    const user = userEvent.setup();
    render(<CodePage username="chen-li" />, { wrapper });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Chen Li" }),
    ).toBeVisible();
    expect(screen.getByText("@chen-li")).toBeVisible();
    expect(screen.getByText(/signed in as Sample planner/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Add friend" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Request sent"),
    );
    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/friends/requests",
      body: { userId: "00000000-0000-4000-8000-000000000005" },
    });
    expect(
      screen.queryByRole("button", { name: "Add friend" }),
    ).not.toBeInTheDocument();
  });

  it("says when the two are already friends, and when no account has the code", async () => {
    render(<CodePage username="MEILIN" />, { wrapper });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Mei Lin" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "You are already friends.",
    );
    cleanup();
    render(<CodePage username="nobody" />, { wrapper });
    expect(await screen.findByText(/No account has this code/)).toBeVisible();
  });

  it("asks for a sign-in first and returns here after it", async () => {
    window.sessionStorage.removeItem("chronelle.session");
    const user = userEvent.setup();
    render(<CodePage username="chen-li" />, { wrapper });
    await user.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(router.push).toHaveBeenCalledWith("/sign-in");
    expect(window.sessionStorage.getItem("chronelle.after-sign-in")).toBe(
      "/u/chen-li",
    );
    expect(screen.queryByText("Chen Li")).not.toBeInTheDocument();
  });
});
