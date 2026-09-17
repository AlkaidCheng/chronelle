// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { WorkspaceShell } from "../components/workspace-shell";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ pathname: "/events" }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => navigation.pathname,
}));

let store: SandboxStore;
let saved: string | null;
const requests: { method: string; path: string; body: unknown }[] = [];

beforeEach(() => {
  saved = null;
  navigation.pathname = "/events";
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

/** Renders the shell and waits for the session to open the rail. */
async function renderShell() {
  render(
    <Providers>
      <WorkspaceShell>
        <p>Page</p>
      </WorkspaceShell>
    </Providers>,
  );
  await screen.findByRole("navigation", { name: "Workspace navigation" });
}

const rail = () =>
  within(screen.getByRole("navigation", { name: "Workspace navigation" }));
const collectionNames = () =>
  within(screen.getByRole("list", { name: "Collections" }))
    .getAllByRole("link")
    .map((link) => link.textContent);

describe("the rail", () => {
  it("lists Search, then the collections, with Trash and Theme under More", async () => {
    await renderShell();
    expect(
      rail().getByRole("button", { name: "Search and commands" }),
    ).toBeVisible();
    expect(collectionNames()).toEqual(["Events", "Tasks", "People"]);
    expect(rail().queryByRole("link", { name: "Trash" })).toBeNull();
    expect(rail().queryByRole("button", { name: "Theme" })).toBeNull();
    expect(screen.getByRole("button", { name: "More" })).toBeVisible();
  });

  it("reorders with the grip's arrow keys and hides with the eye, keeping both on the account", async () => {
    const user = userEvent.setup();
    await renderShell();
    await user.click(screen.getByRole("button", { name: "Customize sidebar" }));
    const grip = screen.getByRole("button", { name: "Move People" });
    grip.focus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    await waitFor(() =>
      expect(collectionNames()).toEqual(["People", "Events", "Tasks"]),
    );
    expect(screen.getByRole("button", { name: "Move People" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Hide Tasks" }));
    expect(screen.getByRole("button", { name: "Show Tasks" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() =>
      expect(requests.filter((request) => request.method === "PATCH")).toEqual([
        {
          method: "PATCH",
          path: "/api/auth/me",
          body: { rail: { order: ["events", "people", "tasks"], hidden: [] } },
        },
        {
          method: "PATCH",
          path: "/api/auth/me",
          body: { rail: { order: ["people", "events", "tasks"], hidden: [] } },
        },
        {
          method: "PATCH",
          path: "/api/auth/me",
          body: {
            rail: { order: ["people", "events", "tasks"], hidden: ["tasks"] },
          },
        },
      ]),
    );
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(collectionNames()).toEqual(["People", "Events"]);
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();

    // The account keeps the arrangement for the next render; the hidden
    // collection still shows while it is the open page.
    cleanup();
    navigation.pathname = "/tasks";
    await renderShell();
    expect(collectionNames()).toEqual(["People", "Events", "Tasks"]);
    expect(rail().getByRole("link", { name: "Tasks" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("starts customizing from More and shows hidden collections dimmed until shown again", async () => {
    const user = userEvent.setup();
    await renderShell();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Customize sidebar" }),
    );
    await user.click(screen.getByRole("button", { name: "Hide People" }));
    await waitFor(() => expect(saved).toContain('"hidden":["people"]'));
    expect(collectionNames()).toEqual(["Events", "Tasks", "People"]);
    await user.click(screen.getByRole("button", { name: "Show People" }));
    await waitFor(() => expect(saved).toContain('"hidden":[]'));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(collectionNames()).toEqual(["Events", "Tasks", "People"]);
  });
});
