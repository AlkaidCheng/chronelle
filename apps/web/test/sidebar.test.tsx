// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { WorkspaceShell } from "../components/workspace-shell";
import {
  displayBootstrap,
  displayStorageKey,
} from "../lib/display-preferences";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";
import { installPointerEvents } from "./row-menu-support";

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
  delete document.documentElement.dataset.sidebar;
});

/** Renders the shell around a page and waits for the session to open the rail. */
async function renderShell(page = <p>Page</p>) {
  render(
    <Providers>
      <WorkspaceShell>{page}</WorkspaceShell>
    </Providers>,
  );
  await screen.findByRole("navigation", { name: "Space navigation" });
}

const rail = () =>
  within(screen.getByRole("navigation", { name: "Space navigation" }));
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

  it("drags a row by its grip with a finger, drops it where the finger rests, and puts it back on Escape", async () => {
    const restorePointerEvents = installPointerEvents();
    try {
      const user = userEvent.setup();
      await renderShell();
      await user.click(
        screen.getByRole("button", { name: "Customize sidebar" }),
      );
      // jsdom lays nothing out: each row reports a 30px band in order.
      const rows = within(
        screen.getByRole("list", { name: "Collections" }),
      ).getAllByRole("listitem");
      rows.forEach((row, index) => {
        vi.spyOn(row, "getBoundingClientRect").mockImplementation(
          () =>
            ({
              top: index * 30,
              bottom: index * 30 + 30,
              height: 30,
              left: 0,
              right: 200,
              width: 200,
              x: 0,
              y: index * 30,
              toJSON: () => ({}),
            }) as DOMRect,
        );
      });
      const grip = screen.getByRole("button", { name: "Move People" });
      const touch = { pointerId: 1, pointerType: "touch", isPrimary: true };

      // Lifted at 75, moved to 10: above the first row's middle, so it lands first.
      fireEvent.pointerDown(grip, { ...touch, clientX: 10, clientY: 75 });
      expect(rows[2]).toHaveAttribute("data-lifted");
      fireEvent.pointerMove(document, { ...touch, clientX: 10, clientY: 10 });
      expect(rows[2]).toHaveStyle({ transform: "translateY(-65px)" });
      expect(rows[0]).toHaveAttribute("data-drop", "before");
      fireEvent.pointerUp(document, { ...touch, clientX: 10, clientY: 10 });
      await waitFor(() =>
        expect(collectionNames()).toEqual(["People", "Events", "Tasks"]),
      );
      expect(document.querySelector("[data-lifted]")).toBeNull();
      await waitFor(() =>
        expect(
          requests.filter((request) => request.method === "PATCH"),
        ).toEqual([
          {
            method: "PATCH",
            path: "/api/auth/me",
            body: {
              rail: { order: ["people", "events", "tasks"], hidden: [] },
            },
          },
        ]),
      );

      // A mouse press on the grip is not a touch drag.
      fireEvent.pointerDown(
        screen.getByRole("button", { name: "Move Tasks" }),
        {
          pointerId: 2,
          pointerType: "mouse",
          clientX: 10,
          clientY: 75,
        },
      );
      expect(document.querySelector("[data-lifted]")).toBeNull();

      // Escape puts a lifted row back without a change.
      const tasks = screen.getByRole("button", { name: "Move Tasks" });
      fireEvent.pointerDown(tasks, { ...touch, clientX: 10, clientY: 75 });
      fireEvent.pointerMove(document, { ...touch, clientX: 10, clientY: 10 });
      expect(document.querySelector("[data-lifted]")).not.toBeNull();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(document.querySelector("[data-lifted]")).toBeNull();
      expect(collectionNames()).toEqual(["People", "Events", "Tasks"]);
      expect(
        requests.filter((request) => request.method === "PATCH"),
      ).toHaveLength(1);
    } finally {
      restorePointerEvents();
    }
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

describe("the sidebar toggle", () => {
  const sidebarKey = displayStorageKey("sidebar");
  const collapseControl = () =>
    screen.getByRole("button", { name: "Collapse sidebar" });
  const expandControl = () =>
    screen.getByRole("button", { name: "Expand sidebar" });
  const expandControlIfShown = () =>
    screen.queryByRole("button", { name: "Expand sidebar" });
  const aside = () => document.querySelector("aside.sidebar");
  /** A window wide enough for the sidebar, or a phone with its bar. */
  const windowWidth = (wide: boolean) =>
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: wide && query === "(min-width: 761px)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );

  it("collapses from the head, hands focus to the edge control, and expands from there", async () => {
    const user = userEvent.setup();
    await renderShell();
    expect(expandControlIfShown()).toBeNull();
    expect(collapseControl()).toHaveAttribute(
      "aria-keyshortcuts",
      "Meta+\\ Control+\\",
    );

    await user.click(collapseControl());
    expect(document.documentElement.dataset.sidebar).toBe("collapsed");
    expect(window.localStorage.getItem(sidebarKey)).toBe("collapsed");
    expect(aside()).toHaveAttribute("inert");
    expect(expandControl()).toHaveFocus();

    await user.click(expandControl());
    expect(document.documentElement.dataset.sidebar).toBe("open");
    expect(window.localStorage.getItem(sidebarKey)).toBeNull();
    expect(aside()).not.toHaveAttribute("inert");
    expect(collapseControl()).toHaveFocus();
    expect(expandControlIfShown()).toBeNull();
  });

  it("folds with Cmd/Ctrl+\\ on a wide window, outside text fields", async () => {
    windowWidth(true);
    await renderShell(<input aria-label="Page field" />);

    fireEvent.keyDown(document.body, { key: "\\", metaKey: true });
    expect(document.documentElement.dataset.sidebar).toBe("collapsed");
    await waitFor(() => expect(expandControl()).toHaveFocus());

    fireEvent.keyDown(document.body, { key: "\\", ctrlKey: true });
    expect(document.documentElement.dataset.sidebar).toBe("open");
    await waitFor(() => expect(collapseControl()).toHaveFocus());

    // A backslash typed into a field, with Shift, or bare is not the shortcut.
    const field = screen.getByRole("textbox", { name: "Page field" });
    fireEvent.keyDown(field, { key: "\\", metaKey: true });
    fireEvent.keyDown(document.body, {
      key: "\\",
      metaKey: true,
      shiftKey: true,
    });
    fireEvent.keyDown(document.body, { key: "\\" });
    expect(document.documentElement.dataset.sidebar).toBe("open");
  });

  it("leaves a phone's bar alone: the shortcut does nothing below the sidebar width", async () => {
    windowWidth(false);
    await renderShell();
    fireEvent.keyDown(document.body, { key: "\\", metaKey: true });
    expect(document.documentElement.dataset.sidebar).toBe("open");
    expect(window.localStorage.getItem(sidebarKey)).toBeNull();
    expect(expandControlIfShown()).toBeNull();
    expect(aside()).not.toHaveAttribute("inert");

    // A choice made on a wide window does not fold the phone's bar either.
    cleanup();
    window.localStorage.setItem(sidebarKey, "collapsed");
    new Function(displayBootstrap)();
    await renderShell();
    expect(expandControlIfShown()).toBeNull();
    expect(aside()).not.toHaveAttribute("inert");
  });

  it("remembers a collapsed sidebar on this device from the first paint", async () => {
    window.localStorage.setItem(sidebarKey, "collapsed");
    new Function(displayBootstrap)();
    expect(document.documentElement.dataset.sidebar).toBe("collapsed");
    await renderShell();
    expect(expandControl()).toBeVisible();
    expect(aside()).toHaveAttribute("inert");
    expect(document.documentElement.dataset.sidebar).toBe("collapsed");
  });
});
