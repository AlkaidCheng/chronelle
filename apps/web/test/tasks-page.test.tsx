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
import { TasksPage } from "../features/tasks/tasks-page";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/tasks",
}));

let store: SandboxStore;
let stored: Record<string, string>;

beforeEach(() => {
  stored = {};
  let saved: string | null = null;
  store = new SandboxStore({
    getItem: () => saved,
    setItem: (_key, value) => {
      saved = value;
    },
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => {
      stored[key] = value;
    },
    removeItem: (key: string) => {
      delete stored[key];
    },
  });
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({ accessToken: "sample", workspaceId: sandboxWorkspaceId }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>((input, options) =>
      store.fetch(input, options),
    ),
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

describe("TasksPage", () => {
  it("lists open tasks from the workspace, filters, and remembers the view", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <TasksPage />
      </Providers>,
    );
    expect(await screen.findByText("1 task loaded")).toBeVisible();
    expect(
      screen.getByRole("row", { name: /Confirm the garden venue/ }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Completed" }));
    expect(await screen.findByText("1 task loaded")).toBeVisible();
    expect(screen.getByRole("row", { name: /Send invitations/ })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "All tasks" }));
    expect(await screen.findByText("2 tasks loaded")).toBeVisible();

    const view = within(screen.getByRole("group", { name: "View" }));
    await user.click(view.getByRole("button", { name: "By day" }));
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("region", { name: /No due date/ })).toBeVisible();
    expect(stored["chronelle.task-view"]).toBe("by-day");
    const requests = vi
      .mocked(fetch)
      .mock.calls.map(([url]) => String(url))
      .filter((url) => url.startsWith("/api/tasks"));
    expect(requests[0]).toBe("/api/tasks?query=&filter=open&sort=due");
    expect(requests).toContain("/api/tasks?query=&filter=done&sort=due");
  });

  it("creates a task on its own and completes it from the list", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <TasksPage />
      </Providers>,
    );
    await screen.findByText("1 task loaded");
    await user.click(screen.getByRole("button", { name: "New task" }));
    const editor = screen.getByRole("dialog", { name: "Add task" });
    await user.type(within(editor).getByLabelText("Task"), "Water the plants");
    await user.type(within(editor).getByLabelText("Due date"), "2031-04-02");
    await user.click(
      within(editor).getByRole("button", { name: "Create task" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add task" })).toBeNull(),
    );
    expect(await screen.findByText("2 tasks loaded")).toBeVisible();
    const created = await store.fetch("/api/tasks?filter=all&sort=name");
    const listed = (await created.json()) as {
      items: {
        displayName: string;
        permissionScopeId: string;
        id: string;
        dueOn: string | null;
      }[];
    };
    const task = listed.items.find(
      (item) => item.displayName === "Water the plants",
    );
    expect(task).toMatchObject({ dueOn: "2031-04-02" });
    // Created outside any Event: it owns its permission scope.
    expect(task?.permissionScopeId).toBe(task?.id);
    const row = screen.getByRole("row", { name: /Water the plants/ });
    expect(within(row).getByText("Apr 2, 2031")).toBeVisible();
    await user.click(
      within(row).getByRole("button", { name: "Complete Water the plants" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("row", { name: /Water the plants/ }),
      ).toBeNull(),
    );
    expect(await screen.findByText("1 task loaded")).toBeVisible();
  });
});
