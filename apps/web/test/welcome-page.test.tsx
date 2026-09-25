// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { WelcomePage } from "../features/account/welcome-page";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/welcome",
}));

let store: SandboxStore;
let saved: string | null;
const requests: { method: string; path: string; body: unknown }[] = [];
const storage = {
  getItem: () => saved,
  setItem: (_key: string, value: string) => {
    saved = value;
  },
};

/** The sample account with the Welcome step still ahead. */
async function freshAccount() {
  saved = null;
  const seed = new SandboxStore(storage);
  await seed.fetch("/api/account", {
    method: "PATCH",
    body: JSON.stringify({ findByName: true }),
  });
  const state = JSON.parse(saved ?? "{}") as {
    preferences: { onboardedAt: string | null; displayName: string };
  };
  state.preferences.onboardedAt = null;
  state.preferences.displayName = "planner";
  saved = JSON.stringify(state);
  store = new SandboxStore(storage);
}

beforeEach(async () => {
  requests.length = 0;
  router.replace.mockClear();
  vi.stubGlobal("localStorage", window.sessionStorage);
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({ accessToken: "sample", workspaceId: sandboxWorkspaceId }),
  );
  await freshAccount();
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

describe("the Welcome step", () => {
  it("names the account, takes the name and the display preferences, and opens the workspace", async () => {
    const user = userEvent.setup();
    render(<WelcomePage />, { wrapper });
    expect(await screen.findByText("@planner")).toBeVisible();
    expect(screen.getByText("planner@example.test")).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 1, name: "Welcome to LivTales" }),
    ).toBeVisible();
    const name = screen.getByRole("textbox", { name: "Name" });
    expect(name).toHaveValue("");
    expect(name).toBeRequired();
    expect(screen.getByRole("combobox", { name: "Language" })).toHaveValue(
      "system",
    );
    expect(
      screen.getByRole("option", { name: "Browser default (English)" }),
    ).toBeVisible();
    const zone = screen.getByRole("combobox", { name: "Time zone" });
    expect(zone).toHaveValue("");
    expect(screen.getByRole("option", { name: /^Device: / })).toBeVisible();
    const clock = screen.getByRole("combobox", { name: "Clock" });
    expect(clock).toHaveValue("");
    expect(screen.getByText(/detected from this device/)).toBeVisible();

    await user.type(name, "Mira Planner");
    await user.selectOptions(clock, "h23");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/events"));
    expect(requests).toContainEqual({
      method: "PATCH",
      path: "/api/auth/me",
      body: { hourCycle: "h23" },
    });
    expect(requests).toContainEqual({
      method: "PATCH",
      path: "/api/account",
      body: { displayName: "Mira Planner", onboarded: true },
    });
    const me = await (await store.fetch("/api/auth/session")).json();
    expect(me.user).toMatchObject({
      displayName: "Mira Planner",
      hourCycle: "h23",
    });
    expect(me.user.onboardedAt).not.toBeNull();
  });

  it("returns to the page that was waiting on the sign-in once the step is done", async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem(
      "chronelle.after-sign-in",
      "/invite/abcdefghijklmnopqrstuvwxyz0123456789",
    );
    render(<WelcomePage />, { wrapper });
    await user.type(
      await screen.findByRole("textbox", { name: "Name" }),
      "Mira Planner",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        "/invite/abcdefghijklmnopqrstuvwxyz0123456789",
      ),
    );
    expect(router.replace).not.toHaveBeenCalledWith("/events");
    expect(window.sessionStorage.getItem("chronelle.after-sign-in")).toBeNull();
  });

  it("sends an account past the step on to the workspace, and a visitor to sign in", async () => {
    saved = null;
    store = new SandboxStore(storage);
    render(<WelcomePage />, { wrapper });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/events"));
    cleanup();
    router.replace.mockClear();
    window.sessionStorage.removeItem("chronelle.session");
    render(<WelcomePage />, { wrapper });
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/sign-in"),
    );
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
  });
});
