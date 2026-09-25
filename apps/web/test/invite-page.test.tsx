// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { InvitePage } from "../features/friends/invite-page";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/invite/sample-invitation-chen-li-0001",
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

describe("the page an invitation link opens", () => {
  it("names who invited, the note, and what follows, and accepts as the signed-in account", async () => {
    const user = userEvent.setup();
    render(<InvitePage token="sample-invitation-chen-li-0001" />, {
      wrapper,
    });
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Chen Li invited you to be friends on LivTales",
      }),
    ).toBeVisible();
    expect(screen.getByText("@chen-li")).toBeVisible();
    expect(
      screen.getByText("Join us for the Kyoto trip planning."),
    ).toBeVisible();
    expect(screen.getByText("Kyoto in November as viewer")).toBeVisible();
    expect(screen.getByText(/signed in as Sample planner/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Not now" })).toHaveAttribute(
      "href",
      "/events",
    );
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(
      await screen.findByText("You and Chen Li are now friends."),
    ).toBeVisible();
    expect(
      screen.getByText("Kyoto in November is shared with you as viewer."),
    ).toBeVisible();
    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/invitations/sample-invitation-chen-li-0001/accept",
      body: undefined,
    });
    expect(
      screen.queryByRole("button", { name: "Accept" }),
    ).not.toBeInTheDocument();
  });

  it("keeps an existing friendship, and refuses the account's own link", async () => {
    const user = userEvent.setup();
    render(<InvitePage token="sample-invitation-mei-lin-0001" />, {
      wrapper,
    });
    await user.click(await screen.findByRole("button", { name: "Accept" }));
    expect(await screen.findByText("You were already friends.")).toBeVisible();
    cleanup();
    render(<InvitePage token="sample-invitation-priya-0001" />, { wrapper });
    expect(
      await screen.findByText("This is your own invitation link."),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Accept" }),
    ).not.toBeInTheDocument();
    cleanup();
    render(<InvitePage token="sample-invitation-nowhere-0001" />, {
      wrapper,
    });
    expect(
      await screen.findByText(/No invitation has this link/),
    ).toBeVisible();
  });

  it("offers Sign in and Create an account when signed out, both returning here", async () => {
    window.sessionStorage.removeItem("chronelle.session");
    const user = userEvent.setup();
    render(<InvitePage token="sample-invitation-chen-li-0001" />, {
      wrapper,
    });
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Chen Li invited you to be friends on LivTales",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Accept" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    expect(router.push).toHaveBeenCalledWith(
      "/sign-up?invitation=sample-invitation-chen-li-0001",
    );
    expect(window.sessionStorage.getItem("chronelle.after-sign-in")).toBe(
      "/invite/sample-invitation-chen-li-0001",
    );
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/sign-in"));
  });
});
