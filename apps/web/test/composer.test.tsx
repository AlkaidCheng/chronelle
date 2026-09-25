// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LivTalesApiClient } from "@livtales/api-client";
import type { EventComponentKind } from "@livtales/schemas";
import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { useState } from "react";
import { Providers } from "../app/providers";
import { TasksPage } from "../features/tasks/tasks-page";
import { dayKeyOf } from "../lib/day-placement";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";
import { PagesHarness } from "./pages-harness";
import { chooseRowAction } from "./row-menu-support";

let pathname = "/tasks";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => pathname,
}));

let store: SandboxStore;
let client: LivTalesApiClient;
let eventId: string;

function page(name: string, kinds: readonly EventComponentKind[]) {
  return {
    id: crypto.randomUUID(),
    name,
    components: kinds.map((kind) => ({ id: crypto.randomUUID(), kind })),
  };
}

/** The sample task's row on the Tasks page. */
const sampleRow = () =>
  screen.getByRole("row", { name: /Confirm the garden venue/ });
const sampleComposer = () =>
  screen.getByRole("form", { name: "Edit Confirm the garden venue" });

/** The Tasks page behind a control that leaves it and comes back, the providers staying. */
function LeaveAndReturn() {
  const [shown, setShown] = useState(true);
  return (
    <>
      <button onClick={() => setShown((current) => !current)} type="button">
        Toggle the page
      </button>
      {shown ? <TasksPage /> : null}
    </>
  );
}

beforeEach(async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  let saved: string | null = null;
  store = new SandboxStore({
    getItem: () => saved,
    setItem: (_key, value) => {
      saved = value;
    },
  });
  client = new LivTalesApiClient({
    getCredential: () => ({
      accessToken: "sample",
      workspaceId: sandboxWorkspaceId,
    }),
    fetch: (input, options) => store.fetch(input, options),
  });
  const events = await client.listEvents({});
  const event = events.items.find(
    (event) => event.displayName === "Autumn gathering",
  );
  assert(event);
  eventId = event.id;
  const stored: Record<string, string> = {};
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
  window.history.replaceState(null, "", "/events");
  pathname = "/tasks";
});

describe("the composer on a row", () => {
  it("opens a pressed row in place, prefilled, and saves one update the row then reads", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <TasksPage />
      </Providers>,
    );
    await screen.findByText("1 task loaded");
    const before = (await client.listTasks({ filter: "open" })).items.find(
      (task) => task.displayName === "Confirm the garden venue",
    );
    assert(before);
    await user.click(
      within(sampleRow()).getByRole("button", {
        name: "Edit Confirm the garden venue",
      }),
    );
    const composer = sampleComposer();
    const name = within(composer).getByLabelText("Task name");
    expect(name).toHaveFocus();
    expect(name).toHaveValue("Confirm the garden venue");
    // The chips read the task: its due, and the fields that are unset.
    expect(
      within(composer).getByRole("button", { name: /^Due: / }),
    ).toBeVisible();
    expect(
      within(composer).getByRole("button", { name: "Location" }),
    ).toBeVisible();
    await user.click(
      within(composer).getByRole("button", { name: "Location" }),
    );
    const location = within(
      screen.getByRole("dialog", { name: "Location" }),
    ).getByLabelText("Location");
    expect(location).toHaveFocus();
    await user.type(location, "The garden{Enter}");
    // Enter in the chip's field closes it and hands focus back to the chip.
    expect(screen.queryByRole("dialog", { name: "Location" })).toBeNull();
    expect(
      within(composer).getByRole("button", { name: "Location: The garden" }),
    ).toHaveFocus();
    await user.click(name);
    await user.keyboard(" today{Enter}");
    await waitFor(() =>
      expect(
        screen.queryByRole("form", { name: "Edit Confirm the garden venue" }),
      ).toBeNull(),
    );
    const row = await screen.findByRole("row", {
      name: /Confirm the garden venue today/,
    });
    expect(within(row).getByText("The garden")).toBeVisible();
    expect(screen.getByText("Saved.")).toBeInTheDocument();
    const after = (await client.listTasks({ filter: "open" })).items.find(
      (task) => task.id === before.id,
    );
    expect(after).toMatchObject({
      displayName: "Confirm the garden venue today",
      location: "The garden",
      version: before.version + 1,
    });
  });

  it("closes unchanged on Cancel and on Escape, and opens from the row menu's Edit", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <TasksPage />
      </Providers>,
    );
    await screen.findByText("1 task loaded");
    const before = (await client.listTasks({ filter: "open" })).items.find(
      (task) => task.displayName === "Confirm the garden venue",
    );
    assert(before);
    await chooseRowAction(user, sampleRow(), "Edit");
    let composer = sampleComposer();
    await user.type(
      within(composer).getByLabelText("Task name"),
      " and the caterer",
    );
    await user.click(within(composer).getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("form", { name: "Edit Confirm the garden venue" }),
    ).toBeNull();
    expect(sampleRow()).toBeVisible();
    await user.click(
      within(sampleRow()).getByRole("button", {
        name: "Edit Confirm the garden venue",
      }),
    );
    composer = sampleComposer();
    // Cancel dropped the change: the composer opens from the task again.
    expect(within(composer).getByLabelText("Task name")).toHaveValue(
      "Confirm the garden venue",
    );
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("form", { name: "Edit Confirm the garden venue" }),
    ).toBeNull();
    const after = (await client.listTasks({ filter: "open" })).items.find(
      (task) => task.id === before.id,
    );
    expect(after?.version).toBe(before.version);
  });

  it("asks before another row opens over unsaved changes", async () => {
    const user = userEvent.setup();
    await client.createTask({ displayName: "Order the flowers" });
    render(
      <Providers>
        <TasksPage />
      </Providers>,
    );
    await screen.findByText("2 tasks loaded");
    await user.click(
      within(sampleRow()).getByRole("button", {
        name: "Edit Confirm the garden venue",
      }),
    );
    await user.type(
      within(sampleComposer()).getByLabelText("Task name"),
      " soon",
    );
    const flowers = screen.getByRole("row", { name: /Order the flowers/ });
    await user.click(
      within(flowers).getByRole("button", { name: "Edit Order the flowers" }),
    );
    // The open row asks; Keep editing leaves it as it was.
    const asked = sampleComposer();
    expect(asked).toHaveTextContent(
      "This row has unsaved changes. Discard them?",
    );
    expect(
      within(asked).getByRole("button", { name: "Keep editing" }),
    ).toHaveFocus();
    await user.click(
      within(asked).getByRole("button", { name: "Keep editing" }),
    );
    expect(within(sampleComposer()).getByLabelText("Task name")).toHaveValue(
      "Confirm the garden venue soon",
    );
    expect(
      screen.queryByRole("form", { name: "Edit Order the flowers" }),
    ).toBeNull();
    // Discard closes it and opens the other row.
    await user.click(
      within(flowers).getByRole("button", { name: "Edit Order the flowers" }),
    );
    await user.click(
      within(sampleComposer()).getByRole("button", { name: "Discard" }),
    );
    expect(
      screen.queryByRole("form", { name: "Edit Confirm the garden venue" }),
    ).toBeNull();
    expect(
      within(
        screen.getByRole("form", { name: "Edit Order the flowers" }),
      ).getByLabelText("Task name"),
    ).toHaveFocus();
    expect(sampleRow()).toHaveTextContent("Confirm the garden venue");
  });

  it("hands its fields to the full editor from More", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <TasksPage />
      </Providers>,
    );
    await screen.findByText("1 task loaded");
    await user.click(
      within(sampleRow()).getByRole("button", {
        name: "Edit Confirm the garden venue",
      }),
    );
    const composer = sampleComposer();
    await user.click(
      within(composer).getByRole("button", { name: "Location" }),
    );
    await user.type(
      within(screen.getByRole("dialog", { name: "Location" })).getByLabelText(
        "Location",
      ),
      "The garden{Enter}",
    );
    await user.click(within(composer).getByRole("button", { name: /^More: / }));
    const editor = await screen.findByRole("dialog", { name: "Edit task" });
    expect(within(editor).getByLabelText("Location")).toHaveValue("The garden");
    expect(
      screen.queryByRole("form", { name: "Edit Confirm the garden venue" }),
    ).toBeNull();
    await user.click(within(editor).getByRole("button", { name: "Save task" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edit task" })).toBeNull(),
    );
    expect(within(sampleRow()).getByText("The garden")).toBeVisible();
  });

  it("keeps an open row's text as a draft and finds it open again", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <LeaveAndReturn />
      </Providers>,
    );
    await screen.findByText("1 task loaded");
    await user.click(
      within(sampleRow()).getByRole("button", {
        name: "Edit Confirm the garden venue",
      }),
    );
    await user.type(
      within(sampleComposer()).getByLabelText("Task name"),
      " with Sam",
    );
    await user.click(screen.getByRole("button", { name: "Toggle the page" }));
    expect(screen.queryByText("1 task loaded")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Toggle the page" }));
    await screen.findByText("1 task loaded");
    const composer = await screen.findByRole("form", {
      name: "Edit Confirm the garden venue",
    });
    expect(within(composer).getByLabelText("Task name")).toHaveValue(
      "Confirm the garden venue with Sam",
    );
  });

  it("refuses a stale save with the comparison, and Keep mine writes over the newest version", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <TasksPage />
      </Providers>,
    );
    await screen.findByText("1 task loaded");
    const before = (await client.listTasks({ filter: "open" })).items.find(
      (task) => task.displayName === "Confirm the garden venue",
    );
    assert(before);
    await user.click(
      within(sampleRow()).getByRole("button", {
        name: "Edit Confirm the garden venue",
      }),
    );
    await user.type(
      within(sampleComposer()).getByLabelText("Task name"),
      " by Friday",
    );
    // Someone else saves the task while the row is open.
    await client.updateTask(before.id, {
      expectedVersion: before.version,
      location: "The hall",
    });
    await user.click(
      within(sampleComposer()).getByRole("button", { name: "Save" }),
    );
    const comparison = await screen.findByText(
      "Saved elsewhere while you edited",
    );
    expect(comparison).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Keep mine" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("form", { name: "Edit Confirm the garden venue" }),
      ).toBeNull(),
    );
    const after = (await client.listTasks({ filter: "open" })).items.find(
      (task) => task.id === before.id,
    );
    // Keep mine writes the whole draft, the location it never had included.
    expect(after).toMatchObject({
      displayName: "Confirm the garden venue by Friday",
      location: null,
      version: before.version + 2,
    });
  });
});

describe("the composer on the add row", () => {
  it("adds a task with a due day from the panel and a location, keeping the composer open", async () => {
    pathname = `/events/${eventId}`;
    window.history.replaceState(null, "", pathname);
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Plan", ["todos"])],
    });
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    await screen.findByRole("heading", { name: "To-dos" });
    await user.click(
      screen.getByRole("button", { name: "Add a task to the list" }),
    );
    const composer = screen.getByRole("form", { name: "New task" });
    await user.keyboard("Book the photographer");
    await user.click(within(composer).getByRole("button", { name: "Due" }));
    await user.type(screen.getByLabelText("Type a date"), "2030-11-03");
    await user.keyboard("{Escape}");
    expect(
      within(composer).getByRole("button", { name: /^Due: Nov 3, 2030/ }),
    ).toBeVisible();
    await user.click(
      within(composer).getByRole("button", { name: "Location" }),
    );
    await user.type(
      within(screen.getByRole("dialog", { name: "Location" })).getByLabelText(
        "Location",
      ),
      "The studio{Enter}",
    );
    await user.click(
      within(composer).getByRole("button", { name: "Add task" }),
    );
    const row = await screen.findByRole("row", {
      name: /Book the photographer/,
    });
    expect(within(row).getByText("The studio")).toBeVisible();
    // The composer stays for the next task, its chips unset again.
    expect(within(composer).getByLabelText("Task name")).toHaveValue("");
    expect(within(composer).getByLabelText("Task name")).toHaveFocus();
    expect(within(composer).getByRole("button", { name: "Due" })).toBeVisible();
    const created = (await client.getEventTodos(eventId)).items.find(
      (task) => task.displayName === "Book the photographer",
    );
    expect(created).toMatchObject({
      dueOn: "2030-11-03",
      location: "The studio",
    });
  });

  it("starts a day group's task on that day and hands More the fields", async () => {
    pathname = `/events/${eventId}`;
    window.history.replaceState(null, "", pathname);
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Plan", ["todos"])],
    });
    const today = dayKeyOf(new Date());
    await client.createEventResource(eventId, {
      commandId: crypto.randomUUID(),
      resource: {
        objectType: "task",
        displayName: "Greet the guests",
        dueOn: today,
      },
    });
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    await screen.findByText("Greet the guests");
    const todos = within(
      screen
        .getByRole("heading", { name: "To-dos" })
        .closest(".planning-panel") as HTMLElement,
    );
    await user.click(todos.getByRole("button", { name: /^Layout: / }));
    await user.click(todos.getByRole("menuitemradio", { name: "By day" }));
    const todayGroup = within(screen.getByRole("region", { name: /Today/ }));
    await user.click(
      todayGroup.getByRole("button", { name: /^Add a task for / }),
    );
    const composer = todos.getByRole("form", { name: "New task" });
    expect(
      within(composer).getByRole("button", { name: /^Due: .*\(today\)/ }),
    ).toBeVisible();
    await user.keyboard("Light the candles");
    await user.click(within(composer).getByRole("button", { name: /^More: / }));
    const editor = await screen.findByRole("dialog", { name: "Add task" });
    expect(within(editor).getByLabelText("Task")).toHaveValue(
      "Light the candles",
    );
    expect(
      within(editor).getByRole("button", { name: /^Due date: .*\(today\)/ }),
    ).toBeVisible();
    expect(todos.queryByRole("form", { name: "New task" })).toBeNull();
  });
});
