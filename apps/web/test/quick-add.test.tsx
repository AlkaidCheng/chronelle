// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChronelleApiClient } from "@chronelle/api-client";
import type { EventComponentKind } from "@chronelle/schemas";
import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Providers } from "../app/providers";
import { EventPages } from "../features/events/event-pages";
import { TasksPage } from "../features/tasks/tasks-page";
import { dayGroupLabel } from "../lib/day-groups";
import { dayKeyOf } from "../lib/day-placement";
import { quickReminderInstant } from "../lib/reminder-fields";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

let pathname = "/tasks";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => pathname,
}));

let store: SandboxStore;
let client: ChronelleApiClient;
let eventId: string;

function page(name: string, kinds: readonly EventComponentKind[]) {
  return {
    id: crypto.randomUUID(),
    name,
    components: kinds.map((kind) => ({ id: crypto.randomUUID(), kind })),
  };
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
  client = new ChronelleApiClient({
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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/events");
  pathname = "/tasks";
});

describe("quick add", () => {
  it("adds tasks to the list from the row at its end and keeps the field open", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <TasksPage />
      </Providers>,
    );
    expect(await screen.findByText("1 task loaded")).toBeVisible();
    const open = screen.getByRole("button", { name: "Add a task to the list" });
    expect(open).toHaveTextContent("Add task");
    await user.click(open);
    const field = screen.getByLabelText("New task");
    expect(field).toHaveFocus();
    await user.keyboard("Buy stamps{Enter}");
    expect(
      await screen.findByRole("row", { name: /Buy stamps/ }),
    ).toBeVisible();
    // The field stays open, empty, and focused for the next one.
    expect(screen.getByLabelText("New task")).toBe(field);
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
    await user.keyboard("Order the cake{Enter}");
    expect(
      await screen.findByRole("row", { name: /Order the cake/ }),
    ).toBeVisible();
    const tasks = await client.listTasks({ filter: "open" });
    expect(
      tasks.items
        .filter((task) =>
          ["Buy stamps", "Order the cake"].includes(task.displayName),
        )
        .map((task) => [task.dueOn, task.dueAt]),
    ).toEqual([
      [null, null],
      [null, null],
    ]);
    // Escape puts the row back; so does leaving the empty field.
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("New task")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Add a task to the list" }),
    );
    expect(screen.getByLabelText("New task")).toHaveFocus();
    await user.tab();
    expect(screen.queryByLabelText("New task")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add a task to the list" }),
    ).toBeVisible();
  });

  it("keeps a typed name the field cannot leave and one the server refuses", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <TasksPage />
      </Providers>,
    );
    expect(await screen.findByText("1 task loaded")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Add a task to the list" }),
    );
    const field = screen.getByLabelText("New task");
    await user.keyboard("Half a thought");
    await user.tab();
    expect(screen.getByLabelText("New task")).toBe(field);
    expect(field).toHaveValue("Half a thought");
    await user.clear(field);
    await user.click(field);
    await user.keyboard(`${"a".repeat(241)}{Enter}`);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong",
    );
    expect(field).toHaveValue("a".repeat(241));
    expect(field).toHaveFocus();
    await user.keyboard("{Backspace}");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("1 task loaded")).toBeVisible();
  });

  it("dates a task added under a day group and times reminders at 9:00", async () => {
    pathname = `/events/${eventId}`;
    window.history.replaceState(null, "", pathname);
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Plan", ["todos", "reminders"])],
    });
    const now = new Date();
    const todayKey = dayKeyOf(now);
    const todayLabel = dayGroupLabel(todayKey, now).label[0];
    await client.createEventResource(eventId, {
      commandId: crypto.randomUUID(),
      resource: {
        objectType: "task",
        displayName: "Greet the guests",
        dueOn: todayKey,
      },
    });
    const at = new Date(now);
    at.setHours(9, 15, 0, 0);
    await client.createEventResource(eventId, {
      commandId: crypto.randomUUID(),
      resource: {
        objectType: "reminder",
        displayName: "Call the florist",
        remindAt: at.toISOString(),
      },
    });
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    await screen.findByText("Greet the guests");
    const panel = (title: string) =>
      within(
        screen
          .getByRole("heading", { name: title })
          .closest(".planning-panel") as HTMLElement,
      );
    const choose = (panel: ReturnType<typeof within>, view: string) =>
      user.click(
        within(panel.getByRole("group", { name: "View" })).getByRole("button", {
          name: view,
        }),
      );

    // The list's row adds a task with no due date; by day, that task's
    // group and today's group each add to their own day.
    const todos = panel("To-dos");
    await user.click(
      todos.getByRole("button", { name: "Add a task to the list" }),
    );
    await user.keyboard("Set up chairs{Enter}");
    expect(
      await todos.findByRole("row", { name: /Set up chairs/ }),
    ).toBeVisible();
    await user.keyboard("{Escape}");
    await choose(todos, "By day");
    await user.click(
      todos.getByRole("button", { name: `Add a task for ${todayLabel}` }),
    );
    await user.keyboard("Light the candles{Enter}");
    await waitFor(() =>
      expect(todos.getByText("Light the candles")).toBeVisible(),
    );
    await user.keyboard("{Escape}");
    await user.click(
      todos.getByRole("button", { name: "Add a task with no due date" }),
    );
    await user.keyboard("Sweep the hall{Enter}");
    await waitFor(() =>
      expect(todos.getByText("Sweep the hall")).toBeVisible(),
    );
    const tasks = (await client.getEventTodos(eventId)).items;
    expect(
      tasks.find((task) => task.displayName === "Light the candles"),
    ).toMatchObject({ dueOn: todayKey, dueAt: null });
    for (const name of ["Set up chairs", "Sweep the hall"])
      expect(tasks.find((task) => task.displayName === name)).toMatchObject({
        dueOn: null,
        dueAt: null,
      });

    const reminders = panel("Reminders");
    const next = quickReminderInstant(null, new Date());
    await user.click(
      reminders.getByRole("button", { name: "Add a reminder to the list" }),
    );
    await user.keyboard("Ring the bell{Enter}");
    await waitFor(() =>
      expect(reminders.getByText("Ring the bell")).toBeVisible(),
    );
    await user.keyboard("{Escape}");
    await choose(reminders, "By day");
    await user.click(
      reminders.getByRole("button", {
        name: `Add a reminder for ${todayLabel}`,
      }),
    );
    await user.keyboard("Buy the cake{Enter}");
    await waitFor(() =>
      expect(reminders.getByText("Buy the cake")).toBeVisible(),
    );
    const items = (await client.getEventReminders(eventId)).items;
    expect(
      items.find((item) => item.displayName === "Ring the bell")?.remindAt,
    ).toBe(next);
    expect(
      items.find((item) => item.displayName === "Buy the cake")?.remindAt,
    ).toBe(quickReminderInstant(todayKey, now));
    // A viewer sees no quick add rows.
    cleanup();
    render(<EventPages eventId={eventId} canEdit={false} />, {
      wrapper: Providers,
    });
    await screen.findByText("Greet the guests");
    expect(screen.queryByRole("button", { name: /^Add a / })).toBeNull();
  });
});
