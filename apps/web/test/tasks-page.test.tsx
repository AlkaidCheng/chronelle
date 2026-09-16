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
    const sample = screen.getByRole("row", {
      name: /Confirm the garden venue/,
    });
    expect(sample).toBeVisible();
    // A task inside an event names it and links to it.
    expect(
      within(sample).getByRole("link", { name: "in Autumn gathering" }),
    ).toHaveAttribute("href", expect.stringMatching(/^\/events\//));
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
    // Week and Month place the loaded page; the undated task sits below.
    await user.click(view.getByRole("button", { name: "Month" }));
    expect(screen.getAllByRole("cell")).toHaveLength(42);
    expect(screen.getByRole("region", { name: "No due date" })).toBeVisible();
    expect(stored["chronelle.task-view"]).toBe("month");
    await user.click(view.getByRole("button", { name: "Week" }));
    expect(screen.getByRole("group", { name: "Period" })).toBeVisible();
    expect(document.querySelector(".week-day.is-today")).not.toBeNull();
    expect(screen.getByRole("region", { name: "No due date" })).toBeVisible();
    expect(stored["chronelle.task-view"]).toBe("week");
    const requests = vi
      .mocked(fetch)
      .mock.calls.map(([url]) => String(url))
      .filter((url) => url.startsWith("/api/tasks"));
    expect(requests[0]).toBe("/api/tasks?query=&filter=open&sort=due");
    expect(requests).toContain("/api/tasks?query=&filter=done&sort=due");
  });

  it("opens on a remembered week or month view", async () => {
    stored["chronelle.task-view"] = "month";
    render(
      <Providers>
        <TasksPage />
      </Providers>,
    );
    await screen.findByText("1 task loaded");
    expect(
      within(screen.getByRole("group", { name: "View" })).getByRole("button", {
        name: "Month",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("cell")).toHaveLength(42);
  });

  it("adds a subtask under a task, nests it, and counts its progress", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <TasksPage />
      </Providers>,
    );
    await screen.findByText("1 task loaded");
    const parentRow = screen.getByRole("row", {
      name: /Confirm the garden venue/,
    });
    await user.click(
      within(parentRow).getByRole("button", {
        name: "Add subtask to Confirm the garden venue",
      }),
    );
    const editor = screen.getByRole("dialog", { name: "Add subtask" });
    expect(
      within(editor).getByText("A subtask of Confirm the garden venue."),
    ).toBeVisible();
    await user.type(within(editor).getByLabelText("Task"), "Call the owner");
    await user.click(
      within(editor).getByRole("button", { name: "Create task" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add subtask" })).toBeNull(),
    );
    expect(await screen.findByText("2 tasks loaded")).toBeVisible();
    const rows = screen.getAllByRole("row").map((row) => row.textContent ?? "");
    expect(rows.findIndex((text) => text.includes("Call the owner"))).toBe(
      rows.findIndex((text) => text.includes("Confirm the garden venue")) + 1,
    );
    const child = screen.getByRole("row", { name: /Call the owner/ });
    // Nested under its parent, the row shows no parent label; by day it does.
    expect(within(child).queryByText(/^Part of/)).toBeNull();
    expect(child.querySelector(".task-nested")).not.toBeNull();
    // A subtask cannot take subtasks of its own.
    expect(
      within(child).queryByRole("button", { name: /^Add subtask/ }),
    ).toBeNull();
    expect(
      within(
        screen.getByRole("row", { name: /Confirm the garden venue/ }),
      ).getByText("0 of 1 subtasks done"),
    ).toBeInTheDocument();
    await user.click(
      within(screen.getByRole("group", { name: "View" })).getByRole("button", {
        name: "By day",
      }),
    );
    expect(screen.getByText("Part of Confirm the garden venue")).toBeVisible();
    const listed = (await (
      await store.fetch("/api/tasks?filter=all&sort=name")
    ).json()) as {
      items: {
        id: string;
        displayName: string;
        parentTaskId: string | null;
        permissionScopeId: string;
      }[];
    };
    const parent = listed.items.find(
      (item) => item.displayName === "Confirm the garden venue",
    );
    const created = listed.items.find(
      (item) => item.displayName === "Call the owner",
    );
    expect(created?.parentTaskId).toBe(parent?.id);
    expect(created?.permissionScopeId).toBe(parent?.permissionScopeId);
  });

  it("adds labels from the editor, shows them, filters by them, and manages them", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <TasksPage />
      </Providers>,
    );
    await screen.findByText("1 task loaded");
    const row = screen.getByRole("row", { name: /Confirm the garden venue/ });
    await user.click(within(row).getByRole("button", { name: "Edit" }));
    const editor = await screen.findByRole("dialog", { name: "Edit task" });
    // The picker opens on demand.
    await user.click(within(editor).getByText("Labels"));
    expect(
      await within(editor).findByText("No labels yet. Add one below."),
    ).toBeVisible();
    await user.type(within(editor).getByLabelText("New label"), "Venue");
    await user.click(within(editor).getByRole("button", { name: "Add label" }));
    // The new label is selected as soon as it exists.
    expect(
      await within(editor).findByRole("checkbox", { name: "Venue" }),
    ).toBeChecked();
    await user.click(within(editor).getByRole("button", { name: "Save task" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edit task" })).toBeNull(),
    );
    const labelled = await screen.findByRole("row", {
      name: /Confirm the garden venue/,
    });
    expect(
      within(within(labelled).getByRole("list", { name: "Labels" })).getByText(
        "Venue",
      ),
    ).toBeVisible();

    // Filtering by the label asks the server and keeps only that task.
    await user.click(screen.getByRole("button", { name: "All tasks" }));
    await screen.findByText("2 tasks loaded");
    const filter = screen.getByLabelText("Filter by label");
    await user.selectOptions(
      filter,
      within(filter).getByRole("option", { name: "Venue" }),
    );
    expect(await screen.findByText("1 task loaded")).toBeVisible();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.map(([url]) => String(url))
        .some((url) => /^\/api\/tasks\?.*label=[0-9a-f-]+/.test(url)),
    ).toBe(true);

    // The manager renames and deletes; a deleted label leaves its tasks.
    await user.click(screen.getByRole("button", { name: "Manage labels" }));
    const manager = await screen.findByRole("dialog", { name: "Labels" });
    const nameInput = within(manager).getByLabelText("Name of Venue");
    await user.clear(nameInput);
    await user.type(nameInput, "Venues");
    await user.click(within(manager).getByRole("button", { name: "Rename" }));
    expect(await within(manager).findByLabelText("Name of Venues")).toHaveValue(
      "Venues",
    );
    await user.click(
      within(manager).getByRole("button", { name: "Delete Venues" }),
    );
    await user.click(
      within(manager).getByRole("button", { name: "Delete Venues" }),
    );
    expect(await within(manager).findByText("No labels yet.")).toBeVisible();
    await user.click(
      within(manager).getByRole("button", { name: "Close labels" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Labels" })).toBeNull(),
    );
    const listed = (await (
      await store.fetch("/api/tasks?filter=all")
    ).json()) as {
      items: { displayName: string; labelIds: string[] }[];
    };
    expect(
      listed.items.find(
        (item) => item.displayName === "Confirm the garden venue",
      )?.labelIds,
    ).toEqual([]);
  });

  it("assigns a task to a person from the editor, shows it, and filters by assignee", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <TasksPage />
      </Providers>,
    );
    await screen.findByText("1 task loaded");
    const row = screen.getByRole("row", { name: /Confirm the garden venue/ });
    await user.click(within(row).getByRole("button", { name: "Edit" }));
    const editor = await screen.findByRole("dialog", { name: "Edit task" });
    // The picker reads the people when it opens; a new person is selected
    // as soon as they exist.
    await user.click(within(editor).getByText("Assignee: Unassigned"));
    expect(
      await within(editor).findByRole("radio", { name: "Unassigned" }),
    ).toBeChecked();
    await user.type(within(editor).getByLabelText("New person"), "Sam Lee");
    await user.click(
      within(editor).getByRole("button", { name: "Add person" }),
    );
    expect(
      await within(editor).findByRole("radio", { name: "Sam Lee" }),
    ).toBeChecked();
    expect(within(editor).getByText("Assignee: Sam Lee")).toBeVisible();
    await user.click(within(editor).getByRole("button", { name: "Save task" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edit task" })).toBeNull(),
    );
    const assigned = await screen.findByRole("row", {
      name: /Confirm the garden venue/,
    });
    expect(within(assigned).getByText("Sam Lee")).toHaveTextContent(
      "Assigned to Sam Lee",
    );

    // Assigning to me creates the signed-in user's person on first use.
    await user.click(screen.getByRole("button", { name: "New task" }));
    const creator = await screen.findByRole("dialog", { name: "Add task" });
    await user.type(within(creator).getByLabelText("Task"), "Water the plants");
    await user.click(within(creator).getByText("Assignee: Unassigned"));
    await user.click(
      await within(creator).findByRole("button", { name: "Assign to me" }),
    );
    expect(
      await within(creator).findByRole("radio", {
        name: "Sample planner (me)",
      }),
    ).toBeChecked();
    await user.click(
      within(creator).getByRole("button", { name: "Create task" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add task" })).toBeNull(),
    );
    await screen.findByText("2 tasks loaded");

    // Filtering by assignee asks the server; Me names the linked person.
    const filter = screen.getByLabelText("Filter by assignee");
    await user.selectOptions(
      filter,
      within(filter).getByRole("option", { name: "Sam Lee" }),
    );
    expect(await screen.findByText("1 task loaded")).toBeVisible();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.map(([url]) => String(url))
        .some((url) => /^\/api\/tasks\?.*assignee=[0-9a-f-]+/.test(url)),
    ).toBe(true);
    await user.selectOptions(
      filter,
      within(filter).getByRole("option", { name: "Me" }),
    );
    expect(
      await screen.findByRole("row", { name: /Water the plants/ }),
    ).toBeVisible();
    expect(screen.getByText("1 task loaded")).toBeVisible();
  });

  it("assigns a task to a person from the editor, shows it, and filters by assignee", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <TasksPage />
      </Providers>,
    );
    await screen.findByText("1 task loaded");
    const row = screen.getByRole("row", { name: /Confirm the garden venue/ });
    await user.click(within(row).getByRole("button", { name: "Edit" }));
    const editor = await screen.findByRole("dialog", { name: "Edit task" });
    // The picker reads the people when it opens; a new person is selected
    // as soon as they exist.
    await user.click(within(editor).getByText("Assignee: Unassigned"));
    expect(
      await within(editor).findByRole("radio", { name: "Unassigned" }),
    ).toBeChecked();
    await user.type(within(editor).getByLabelText("New person"), "Sam Lee");
    await user.click(
      within(editor).getByRole("button", { name: "Add person" }),
    );
    expect(
      await within(editor).findByRole("radio", { name: "Sam Lee" }),
    ).toBeChecked();
    expect(within(editor).getByText("Assignee: Sam Lee")).toBeVisible();
    await user.click(within(editor).getByRole("button", { name: "Save task" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edit task" })).toBeNull(),
    );
    const assigned = await screen.findByRole("row", {
      name: /Confirm the garden venue/,
    });
    expect(within(assigned).getByText("Sam Lee")).toHaveTextContent(
      "Assigned to Sam Lee",
    );

    // Assigning to me creates the signed-in user's person on first use.
    await user.click(screen.getByRole("button", { name: "New task" }));
    const creator = await screen.findByRole("dialog", { name: "Add task" });
    await user.type(within(creator).getByLabelText("Task"), "Water the plants");
    await user.click(within(creator).getByText("Assignee: Unassigned"));
    await user.click(
      await within(creator).findByRole("button", { name: "Assign to me" }),
    );
    expect(
      await within(creator).findByRole("radio", {
        name: "Sample planner (me)",
      }),
    ).toBeChecked();
    await user.click(
      within(creator).getByRole("button", { name: "Create task" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add task" })).toBeNull(),
    );
    await screen.findByText("2 tasks loaded");

    // Filtering by assignee asks the server; Me names the linked person.
    const filter = screen.getByLabelText("Filter by assignee");
    await user.selectOptions(
      filter,
      within(filter).getByRole("option", { name: "Sam Lee" }),
    );
    expect(await screen.findByText("1 task loaded")).toBeVisible();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.map(([url]) => String(url))
        .some((url) => /^\/api\/tasks\?.*assignee=[0-9a-f-]+/.test(url)),
    ).toBe(true);
    await user.selectOptions(
      filter,
      within(filter).getByRole("option", { name: "Me" }),
    );
    expect(
      await screen.findByRole("row", { name: /Water the plants/ }),
    ).toBeVisible();
    expect(screen.getByText("1 task loaded")).toBeVisible();
  });

  it("keeps where a task happens and shows it on the row", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <TasksPage />
      </Providers>,
    );
    await screen.findByText("1 task loaded");
    const row = screen.getByRole("row", { name: /Confirm the garden venue/ });
    await user.click(within(row).getByRole("button", { name: "Edit" }));
    const editor = await screen.findByRole("dialog", { name: "Edit task" });
    await user.type(
      within(editor).getByLabelText("Location"),
      "  The garden  ",
    );
    await user.click(within(editor).getByRole("button", { name: "Save task" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edit task" })).toBeNull(),
    );
    const placed = await screen.findByRole("row", {
      name: /Confirm the garden venue/,
    });
    expect(within(placed).getByText("The garden")).toHaveTextContent(
      "At The garden",
    );
    // The field counts its characters and stops at the limit: a longer
    // paste is cut to 240 and the count turns red at 240 / 240.
    await user.click(within(placed).getByRole("button", { name: "Edit" }));
    const full = await screen.findByRole("dialog", { name: "Edit task" });
    const field = within(full).getByLabelText("Location");
    expect(within(full).getByText("10 / 240")).not.toHaveClass(
      "field-count-full",
    );
    await user.clear(field);
    await user.paste("x".repeat(241));
    expect(field).toHaveValue("x".repeat(240));
    expect(within(full).getByText("240 / 240")).toHaveClass("field-count-full");
    await user.click(within(full).getByRole("button", { name: "Cancel" }));
    await user.click(within(full).getByRole("button", { name: "Discard" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edit task" })).toBeNull(),
    );
    // Reopening shows the trimmed location; clearing it removes the line.
    await user.click(within(placed).getByRole("button", { name: "Edit" }));
    const again = await screen.findByRole("dialog", { name: "Edit task" });
    expect(within(again).getByLabelText("Location")).toHaveValue("The garden");
    await user.clear(within(again).getByLabelText("Location"));
    await user.click(within(again).getByRole("button", { name: "Save task" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edit task" })).toBeNull(),
    );
    await waitFor(() => expect(screen.queryByText("The garden")).toBeNull());
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
    expect(within(row).queryByRole("link", { name: /^in / })).toBeNull();
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
