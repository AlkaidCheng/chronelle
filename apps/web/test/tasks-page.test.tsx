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
import { monthDays } from "../lib/day-placement";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";
import { setRowDate } from "./date-rows";
import {
  chooseRowAction,
  firePointer,
  installPointerEvents,
  installRowLayout,
} from "./row-menu-support";

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

/** Opens the Layout menu and chooses a template by its name. */
async function chooseLayout(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(screen.getByRole("button", { name: /^Layout: / }));
  await user.click(screen.getByRole("menuitemradio", { name }));
}

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
      within(sample).getByRole("link", { name: "Autumn gathering" }),
    ).toHaveAttribute("href", expect.stringMatching(/^\/events\//));
    // The Filter menu chooses the status; it stays open between choices
    // and the button counts what differs from Open.
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Done" }));
    expect(await screen.findByText("1 task loaded")).toBeVisible();
    expect(screen.getByRole("row", { name: /Send invitations/ })).toBeVisible();
    await user.click(screen.getByRole("menuitemradio", { name: "All" }));
    expect(await screen.findByText("2 tasks loaded")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("button", { name: "Filter: 1 filter" }),
    ).toHaveClass("is-active");

    await chooseLayout(user, "By day");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("region", { name: /No due date/ })).toBeVisible();
    expect(stored["chronelle.task-view"]).toBe("by-day");
    // The week and the calendar ask the server for their days in this time
    // zone, so the undated task is not in them.
    await chooseLayout(user, "Calendar");
    expect(await screen.findByRole("table")).toBeVisible();
    expect(screen.getAllByRole("cell")).toHaveLength(
      monthDays(new Date()).length,
    );
    expect(screen.queryByRole("region", { name: "No due date" })).toBeNull();
    expect(stored["chronelle.task-view"]).toBe("month");
    await chooseLayout(user, "By week");
    expect(screen.getByRole("group", { name: "Period" })).toBeVisible();
    await waitFor(() =>
      expect(document.querySelector(".week-day.is-today")).not.toBeNull(),
    );
    expect(stored["chronelle.task-view"]).toBe("week");
    const requests = vi
      .mocked(fetch)
      .mock.calls.map(([url]) => String(url))
      .filter((url) => url.startsWith("/api/tasks"));
    expect(requests[0]).toBe("/api/tasks?query=&filter=open&sort=manual");
    expect(requests).toContain("/api/tasks?query=&filter=done&sort=manual");
    const timezone = encodeURIComponent(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    const ranged = requests.filter((url) => url.includes("dueFrom="));
    expect(ranged).toHaveLength(2);
    for (const url of ranged)
      expect(url).toMatch(
        new RegExp(
          `^/api/tasks\\?query=&filter=all&sort=manual&dueFrom=\\d{4}-\\d{2}-\\d{2}&dueTo=\\d{4}-\\d{2}-\\d{2}&timezone=${timezone}&limit=50$`,
        ),
      );
  });

  it("opens on a remembered month and loads every page of its days", async () => {
    stored["chronelle.task-view"] = "month";
    // More tasks due today than one page holds.
    const today = new Date();
    const pad = (part: number) => String(part).padStart(2, "0");
    const dueOn = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    for (let index = 0; index < 51; index += 1) {
      const response = await store.fetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ displayName: `Errand ${index + 1}`, dueOn }),
      });
      expect(response.ok).toBe(true);
    }
    render(
      <Providers>
        <TasksPage />
      </Providers>,
    );
    // The sample task two weeks out may or may not fall inside the grid.
    expect(await screen.findByText(/^5[12] tasks loaded$/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Layout: Calendar" }),
    ).toBeVisible();
    expect(screen.getAllByRole("cell")).toHaveLength(
      monthDays(new Date()).length,
    );
    expect(screen.getByRole("button", { name: "+48 more" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Load more tasks/ }),
    ).toBeNull();
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
    await chooseRowAction(user, parentRow, "Add subtask");
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
    await user.click(
      within(child).getByRole("button", { name: /^Actions for/ }),
    );
    expect(screen.queryByRole("menuitem", { name: "Add subtask" })).toBeNull();
    await user.keyboard("{Escape}");
    expect(
      within(
        screen.getByRole("row", { name: /Confirm the garden venue/ }),
      ).getByText("0 of 1 subtasks done"),
    ).toBeInTheDocument();
    await chooseLayout(user, "By day");
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
    await chooseRowAction(user, row, "Edit");
    // The row opens in place; More reaches the full editor.
    await user.click(await screen.findByRole("button", { name: /^More: / }));
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
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.click(screen.getByRole("menuitemradio", { name: "All" }));
    await screen.findByText("2 tasks loaded");
    await user.click(screen.getByRole("menuitemradio", { name: "Venue" }));
    expect(await screen.findByText("1 task loaded")).toBeVisible();
    await user.keyboard("{Escape}");
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
      within(manager).getByRole("button", { name: "Remove Venues" }),
    );
    await user.click(
      within(manager).getByRole("button", { name: "Remove Venues" }),
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
    await chooseRowAction(user, row, "Edit");
    // The row opens in place; More reaches the full editor.
    await user.click(await screen.findByRole("button", { name: /^More: / }));
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
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Sam Lee" }));
    expect(await screen.findByText("1 task loaded")).toBeVisible();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.map(([url]) => String(url))
        .some((url) => /^\/api\/tasks\?.*assignee=[0-9a-f-]+/.test(url)),
    ).toBe(true);
    await user.click(screen.getByRole("menuitemradio", { name: "Me" }));
    expect(
      await screen.findByRole("row", { name: /Water the plants/ }),
    ).toBeVisible();
    expect(screen.getByText("1 task loaded")).toBeVisible();
    await user.keyboard("{Escape}");
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
    await chooseRowAction(user, row, "Edit");
    // The row opens in place; More reaches the full editor.
    await user.click(await screen.findByRole("button", { name: /^More: / }));
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
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Sam Lee" }));
    expect(await screen.findByText("1 task loaded")).toBeVisible();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.map(([url]) => String(url))
        .some((url) => /^\/api\/tasks\?.*assignee=[0-9a-f-]+/.test(url)),
    ).toBe(true);
    await user.click(screen.getByRole("menuitemradio", { name: "Me" }));
    expect(
      await screen.findByRole("row", { name: /Water the plants/ }),
    ).toBeVisible();
    expect(screen.getByText("1 task loaded")).toBeVisible();
    await user.keyboard("{Escape}");
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
    await chooseRowAction(user, row, "Edit");
    // The row opens in place; More reaches the full editor.
    await user.click(await screen.findByRole("button", { name: /^More: / }));
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
    // The field counts its characters only within the last twenty of the
    // limit and stops there: a longer paste is cut to 240 and the count
    // turns red at 240 / 240.
    await chooseRowAction(user, placed, "Edit");
    await user.click(await screen.findByRole("button", { name: /^More: / }));
    const full = await screen.findByRole("dialog", { name: "Edit task" });
    const field = within(full).getByLabelText("Location");
    expect(within(full).queryByText("10 / 240")).toBeNull();
    await user.clear(field);
    await user.paste("x".repeat(220));
    expect(within(full).getByText("220 / 240")).not.toHaveClass(
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
    // Reopening the row shows the trimmed location on its chip; clearing
    // the chip and saving removes the line.
    await chooseRowAction(user, placed, "Edit");
    const again = await screen.findByRole("form", {
      name: "Edit Confirm the garden venue",
    });
    expect(
      within(again).getByRole("button", { name: "Location: The garden" }),
    ).toBeVisible();
    await user.click(
      within(again).getByRole("button", { name: "Clear Location" }),
    );
    await user.click(within(again).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("form", { name: "Edit Confirm the garden venue" }),
      ).toBeNull(),
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
    await setRowDate(user, /^Set due date/, "2031-04-02", undefined, editor);
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

  it("moves a task a step from its menu and sets its due from the Due choices", async () => {
    const user = userEvent.setup();
    for (const displayName of ["Order the cake", "Call the band"]) {
      const response = await store.fetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ displayName }),
      });
      expect(response.ok).toBe(true);
    }
    render(
      <Providers>
        <TasksPage />
      </Providers>,
    );
    await screen.findByText("3 tasks loaded");
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.click(screen.getByRole("menuitemradio", { name: "All" }));
    await user.keyboard("{Escape}");
    await screen.findByText("4 tasks loaded");
    const rowNames = () =>
      screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.querySelector("strong")?.textContent);
    expect(rowNames()).toEqual([
      "Confirm the garden venue",
      "Send invitations",
      "Order the cake",
      "Call the band",
    ]);
    // The first row cannot move up; the last cannot move down.
    const first = screen.getByRole("row", { name: /Confirm the garden venue/ });
    await user.click(
      within(first).getByRole("button", { name: /^Actions for/ }),
    );
    expect(screen.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Move down" })).toBeEnabled();
    await user.keyboard("{Escape}");
    const band = screen.getByRole("row", { name: /Call the band/ });
    await chooseRowAction(user, band, "Move up");
    await waitFor(() =>
      expect(rowNames()).toEqual([
        "Confirm the garden venue",
        "Send invitations",
        "Call the band",
        "Order the cake",
      ]),
    );
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent(
      "Call the band is now 3 of 4.",
    );
    // Only the moved task was written: it took the midpoint rank.
    const listed = (await (
      await store.fetch("/api/tasks?filter=all&sort=manual")
    ).json()) as {
      items: { displayName: string; rank: string; version: number }[];
    };
    expect(
      listed.items.map((item) => [item.displayName, item.rank, item.version]),
    ).toEqual([
      ["Confirm the garden venue", "00000001000", 1],
      ["Send invitations", "00000002000", 1],
      ["Call the band", "00000002500", 2],
      ["Order the cake", "00000003000", 1],
    ]);
    // The menu button keeps focus after the move.
    expect(
      within(screen.getByRole("row", { name: /Call the band/ })).getByRole(
        "button",
        { name: "Actions for Call the band" },
      ),
    ).toHaveFocus();

    // Due opens its choices in place; Tomorrow sets the date.
    await user.click(
      within(screen.getByRole("row", { name: /Order the cake/ })).getByRole(
        "button",
        { name: /^Actions for/ },
      ),
    );
    await user.click(screen.getByRole("menuitem", { name: "Due" }));
    expect(
      screen.getByRole("menuitemradio", { name: "No date" }),
    ).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitemradio", { name: "Tomorrow" }));
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const pad = (part: number) => String(part).padStart(2, "0");
    const tomorrowKey = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
    await waitFor(async () => {
      const after = (await (
        await store.fetch("/api/tasks?filter=all&sort=manual")
      ).json()) as { items: { displayName: string; dueOn: string | null }[] };
      expect(
        after.items.find((item) => item.displayName === "Order the cake")
          ?.dueOn,
      ).toBe(tomorrowKey);
    });
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent(
      "Order the cake is due tomorrow.",
    );
  });

  it("drags a task above another in the list and onto another day by day", async () => {
    const restorePointerEvents = installPointerEvents();
    const user = userEvent.setup();
    const now = new Date();
    const pad = (part: number) => String(part).padStart(2, "0");
    const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    for (const body of [
      { displayName: "Order the cake" },
      { displayName: "Call the band", dueOn: todayKey },
    ]) {
      const response = await store.fetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify(body),
      });
      expect(response.ok).toBe(true);
    }
    render(
      <Providers>
        <TasksPage />
      </Providers>,
    );
    await screen.findByText("3 tasks loaded");
    const rowNames = () =>
      screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.querySelector("strong")?.textContent);
    expect(rowNames()).toEqual([
      "Confirm the garden venue",
      "Order the cake",
      "Call the band",
    ]);
    // jsdom has no layout: rows are 40px tall in document order, and the
    // landing spot follows the pointer's height alone, the nearest row,
    // before or after its middle.
    installRowLayout();
    const pointer = firePointer;
    const cake = screen.getByRole("row", { name: /Order the cake/ });
    pointer("pointerDown", cake, 10, 60, 1);
    // A short move is still a click; nothing is dragged yet.
    pointer("pointerMove", document, 12, 62, 1);
    expect(document.querySelector(".row-drag-card")).toBeNull();
    pointer("pointerMove", document, 10, 5, 1);
    // The lifted row leaves the list as a card, and a gap of its height
    // sits where it will land: above the first row.
    expect(document.querySelector(".row-drag-card")).toHaveTextContent(
      "Order the cake",
    );
    expect(cake).toHaveClass("is-dragging");
    const gap = document.querySelector(".row-gap-cell");
    expect(gap).not.toBeNull();
    expect(gap?.closest("tr")?.nextElementSibling).toBe(
      screen.getByRole("row", { name: /Confirm the garden venue/ }),
    );
    pointer("pointerUp", document, 10, 5, 1);
    await waitFor(() =>
      expect(rowNames()).toEqual([
        "Order the cake",
        "Confirm the garden venue",
        "Call the band",
      ]),
    );
    expect(document.querySelector(".row-drag-card")).toBeNull();
    expect(document.querySelector(".row-gap-cell")).toBeNull();
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent(
      "Order the cake moved.",
    );
    // The click that ended the drag opened nothing.
    expect(screen.queryByRole("dialog")).toBeNull();

    // By day, a drop just under another day's row (past its middle) sets the
    // due to that day and ranks the task after the rows there.
    await chooseLayout(user, "By day");
    const today = screen.getByRole("region", { name: /Today/ });
    expect(within(today).getByText("Call the band")).toBeVisible();
    const undatedRow = within(
      screen.getByRole("region", { name: /No due date/ }),
    )
      .getByText("Order the cake")
      .closest("li");
    expect(undatedRow).not.toBeNull();
    if (undatedRow === null) return;
    pointer("pointerDown", undatedRow, 10, 60, 2);
    pointer("pointerMove", document, 10, 39, 2);
    pointer("pointerUp", document, 10, 39, 2);
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: /Today/ })).getByText(
          "Order the cake",
        ),
      ).toBeVisible(),
    );
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent(
      "Order the cake is due today.",
    );
    const listed = (await (
      await store.fetch("/api/tasks?filter=all&sort=manual")
    ).json()) as {
      items: { displayName: string; dueOn: string | null; rank: string }[];
    };
    expect(
      listed.items.find((item) => item.displayName === "Order the cake"),
    ).toMatchObject({ dueOn: todayKey, rank: "00000005000" });
    restorePointerEvents();
  });

  it("duplicates a task beside it and copies its link", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(
      <Providers>
        <TasksPage />
      </Providers>,
    );
    await screen.findByText("1 task loaded");
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.click(screen.getByRole("menuitemradio", { name: "All" }));
    await user.keyboard("{Escape}");
    await screen.findByText("2 tasks loaded");
    const row = screen.getByRole("row", { name: /Confirm the garden venue/ });
    await chooseRowAction(user, row, "Copy link");
    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(
        /^http:\/\/localhost(:\d+)?\/events\/[0-9a-f-]+#task-[0-9a-f-]+$/,
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "" })).toHaveTextContent(
        "Link copied.",
      ),
    );
    await chooseRowAction(user, row, "Duplicate");
    expect(await screen.findByText("3 tasks loaded")).toBeVisible();
    const copy = screen.getByRole("row", {
      name: /Confirm the garden venue \(copy\)/,
    });
    expect(copy).toBeVisible();
    expect(
      within(copy).getByRole("link", { name: "Autumn gathering" }),
    ).toBeVisible();
    const listed = (await (
      await store.fetch("/api/tasks?filter=all&sort=manual")
    ).json()) as { items: { displayName: string; rank: string }[] };
    expect(listed.items.map((item) => item.displayName)).toEqual([
      "Confirm the garden venue",
      "Confirm the garden venue (copy)",
      "Send invitations",
    ]);
  });
});
