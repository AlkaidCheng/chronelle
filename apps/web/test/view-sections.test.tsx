// @vitest-environment jsdom

import { ChronelleApiClient } from "@chronelle/api-client";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import { groupBySection, sectionAfterStep } from "../lib/section-groups";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";
import { PagesHarness } from "./pages-harness";
import {
  chooseRowAction,
  firePointer,
  installPointerEvents,
  installRowLayout,
} from "./row-menu-support";

let store: SandboxStore;
let client: ChronelleApiClient;
let eventId: string;

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
  window.history.replaceState(null, "", `/events/${eventId}`);
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
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/events");
});

const section = (
  id: string,
  name: string,
  rank: string,
  view: "todos" | "expenses" = "todos",
) => ({
  id,
  workspaceId: sandboxWorkspaceId,
  eventId: "e1",
  view,
  name,
  description: null,
  rank,
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
});

describe("section groups", () => {
  it("puts the loose records first and each section's in the sections' order", () => {
    const sections = [
      section("s1", "Before", "00000001000"),
      section("s2", "After", "00000002000"),
    ];
    const items = [
      { id: "a", sectionId: "s2" },
      { id: "b", sectionId: null },
      { id: "c", sectionId: "s1" },
      { id: "d", sectionId: "gone" },
      { id: "e", sectionId: "s2" },
    ];
    const grouped = groupBySection(items, sections);
    expect(grouped.loose.map(({ id }) => id)).toEqual(["b", "d"]);
    expect(
      grouped.groups.map(({ section, items }) => [
        section.name,
        items.map(({ id }) => id),
      ]),
    ).toEqual([
      ["Before", ["c"]],
      ["After", ["a", "e"]],
    ]);
  });

  it("names the section a step lands after, or none at the ends", () => {
    const sections = [
      section("s1", "One", "00000001000"),
      section("s2", "Two", "00000002000"),
      section("s3", "Three", "00000003000"),
    ];
    expect(sectionAfterStep(sections, "s2", -1)).toBeNull();
    expect(sectionAfterStep(sections, "s3", -1)).toBe("s1");
    expect(sectionAfterStep(sections, "s1", 1)).toBe("s2");
    expect(sectionAfterStep(sections, "s3", 1)).toBeUndefined();
    expect(sectionAfterStep(sections, "s1", -1)).toBeUndefined();
    expect(sectionAfterStep(sections, "missing", 1)).toBeUndefined();
  });
});

async function openTodos(layout: readonly ("todos" | "expenses")[]) {
  await client.updateEventLayout(eventId, {
    expectedVersion: 0,
    pages: [
      {
        id: crypto.randomUUID(),
        name: "Plan",
        components: layout.map((kind) => ({ id: crypto.randomUUID(), kind })),
      },
    ],
  });
}

const createTask = async (displayName: string, sectionId?: string) =>
  (
    await client.createEventResource(eventId, {
      commandId: crypto.randomUUID(),
      resource: {
        objectType: "task",
        displayName,
        ...(sectionId === undefined ? {} : { sectionId }),
      },
    })
  ).resource;

/** The To-dos panel's task names in the order shown. */
const taskNames = (panel: HTMLElement) =>
  Array.from(panel.querySelectorAll("tr[data-row-id]")).map(
    (row) => row.querySelector("strong")?.textContent,
  );

/** The panel's section names in the order shown. */
const sectionNames = (panel: HTMLElement) =>
  Array.from(panel.querySelectorAll(".section-name")).map(
    (name) => name.textContent,
  );

async function todosPanel() {
  const heading = await screen.findByRole("heading", { name: "To-dos" });
  return within(heading).getByText("To-dos").closest("section") as HTMLElement;
}

describe("sections in To-dos", () => {
  it("adds a section between groups, places a task by its add row, edits and moves it from its menu, and deletes it leaving the tasks loose", async () => {
    await openTodos(["todos"]);
    await createTask("Order the cake");
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    const todos = await todosPanel();
    await within(todos).findByText("Order the cake");
    expect(sectionNames(todos)).toEqual([]);

    // Add section under the loose rows: the editor takes a name and a
    // description; an empty name cannot save; Enter saves.
    const addLines = within(todos).getAllByRole("button", {
      name: "Add section",
    });
    expect(addLines).toHaveLength(1);
    await user.click(addLines[0] as HTMLElement);
    const editor = within(todos).getByRole("form", { name: "Add section" });
    expect(within(editor).getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(within(editor).getByLabelText("Section name"), "Venue");
    await user.type(
      within(editor).getByLabelText("Description (optional)"),
      "Everything about the hall",
    );
    await user.keyboard("{Enter}");
    await waitFor(() => expect(sectionNames(todos)).toEqual(["Venue"]));
    expect(within(todos).getByText("Everything about the hall")).toBeVisible();
    expect(within(todos).getByRole("status")).toHaveTextContent(
      "Section Venue added.",
    );
    // The loose rows keep no heading; the section's own add row follows
    // its rows, and an Add section line follows each group.
    expect(
      within(todos).getAllByRole("button", { name: "Add section" }),
    ).toHaveLength(2);

    // A second section after the first, then one between the two.
    const addAfter = async (at: number, name: string) => {
      await user.click(
        within(todos).getAllByRole("button", { name: "Add section" })[
          at
        ] as HTMLElement,
      );
      await user.type(
        within(todos).getByLabelText("Section name"),
        `${name}{Enter}`,
      );
      await waitFor(() => expect(sectionNames(todos)).toContain(name));
    };
    await addAfter(1, "Music");
    expect(sectionNames(todos)).toEqual(["Venue", "Music"]);
    await addAfter(1, "Food");
    expect(sectionNames(todos)).toEqual(["Venue", "Food", "Music"]);

    // A task added from a section's add row lands in that section.
    const foodBody = within(todos)
      .getByText("Food")
      .closest("tbody") as HTMLElement;
    await user.click(
      within(foodBody).getByRole("button", { name: "Add a task to Food" }),
    );
    // The section's add row opens the composer, its section preset.
    await user.type(
      within(foodBody).getByRole("textbox", { name: "Task name" }),
      "Book the caterer{Enter}",
    );
    await waitFor(() =>
      expect(within(foodBody).getByText("Book the caterer")).toBeVisible(),
    );
    expect(taskNames(todos)).toEqual([
      "Confirm the garden venue",
      "Order the cake",
      "Book the caterer",
    ]);
    expect(within(foodBody).getByText("1")).toBeVisible();
    const tasks = await client.getEventTodos(eventId);
    const caterer = tasks.items.find(
      (task) => task.displayName === "Book the caterer",
    );
    const food = tasks.sections.find((section) => section.name === "Food");
    expect(caterer?.sectionId).toBe(food?.id);

    // Edit section opens the same editor, prefilled; Escape cancels.
    // The head gives way to the editor and comes back on cancel, so it is
    // looked up each time.
    const headOf = (name: string) =>
      within(todos).getByText(name).closest(".section-head") as HTMLElement;
    await chooseRowAction(user, headOf("Food"), "Edit section");
    const edit = within(todos).getByRole("form", { name: "Edit section" });
    expect(within(edit).getByLabelText("Section name")).toHaveValue("Food");
    await user.keyboard("{Escape}");
    expect(
      within(todos).queryByRole("form", { name: "Edit section" }),
    ).toBeNull();
    await chooseRowAction(user, headOf("Food"), "Edit section");
    await user.clear(within(todos).getByLabelText("Section name"));
    await user.type(
      within(todos).getByLabelText("Section name"),
      "Catering{Enter}",
    );
    await waitFor(() =>
      expect(sectionNames(todos)).toEqual(["Venue", "Catering", "Music"]),
    );

    // Move down from the menu; Move up is offered on the first only as disabled.
    await chooseRowAction(
      user,
      within(todos)
        .getByText("Catering")
        .closest(".section-head") as HTMLElement,
      "Move down",
    );
    await waitFor(() =>
      expect(sectionNames(todos)).toEqual(["Venue", "Music", "Catering"]),
    );
    await user.click(
      within(
        within(todos)
          .getByText("Venue")
          .closest(".section-head") as HTMLElement,
      ).getByRole("button", { name: "Actions for Venue" }),
    );
    expect(screen.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
    await user.keyboard("{Escape}");

    // Delete section leaves its task in the list, loose.
    await chooseRowAction(
      user,
      within(todos)
        .getByText("Catering")
        .closest(".section-head") as HTMLElement,
      "Delete section",
    );
    await waitFor(() =>
      expect(sectionNames(todos)).toEqual(["Venue", "Music"]),
    );
    expect(taskNames(todos)).toEqual([
      "Confirm the garden venue",
      "Order the cake",
      "Book the caterer",
    ]);
    const loose = within(todos)
      .getByText("Book the caterer")
      .closest("tbody") as HTMLElement;
    expect(loose.querySelector(".section-head")).toBeNull();
    expect(within(todos).getByRole("status")).toHaveTextContent(
      "Section Catering deleted. Its tasks stay in the list.",
    );
  });

  it("drags a task into another section by its grip and a section head among the sections, and the grip's keys move a row a place", async () => {
    const restorePointerEvents = installPointerEvents();
    await openTodos(["todos"]);
    const venue = await client.createSection(eventId, {
      view: "todos",
      name: "Venue",
    });
    const music = await client.createSection(eventId, {
      view: "todos",
      name: "Music",
    });
    await createTask("Order the cake");
    await createTask("Book the hall", venue.id);
    await createTask("Call the band", music.id);
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    const todos = await todosPanel();
    await within(todos).findByText("Call the band");
    expect(taskNames(todos)).toEqual([
      "Confirm the garden venue",
      "Order the cake",
      "Book the hall",
      "Call the band",
    ]);
    // Rows are 40px tall in document order: the venue at 0, the cake at
    // 40, the hall at 80, the band at 120; the section heads span their rows.
    installRowLayout();

    // Lifting the cake by its grip shows the card at once; dragging past
    // the band's middle puts the gap after it, in Music.
    const grip = within(todos).getByRole("button", {
      name: "Reorder Order the cake",
    });
    firePointer("pointerDown", grip, 5, 60, 1);
    expect(document.querySelector(".row-drag-card")).toHaveTextContent(
      "Order the cake",
    );
    firePointer("pointerMove", document, 5, 155, 1);
    const musicBody = within(todos)
      .getByText("Music")
      .closest("tbody") as HTMLElement;
    expect(musicBody.querySelector(".row-gap-cell")).not.toBeNull();
    firePointer("pointerUp", document, 5, 155, 1);
    await waitFor(() =>
      expect(taskNames(todos)).toEqual([
        "Confirm the garden venue",
        "Book the hall",
        "Call the band",
        "Order the cake",
      ]),
    );
    const moved = (await client.getEventTodos(eventId)).items.find(
      (task) => task.displayName === "Order the cake",
    );
    expect(moved?.sectionId).toBe(music.id);
    expect(moved?.version).toBe(2);
    // One write carried the section and the rank.
    interface Command {
      readonly edits: readonly { readonly patch: Record<string, unknown> }[];
    }
    const commands = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter(([, init]) => init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)) as Partial<Command>)
      .filter((body): body is Command => Array.isArray(body.edits));
    expect(commands).toHaveLength(1);
    const edit = commands[0]?.edits[0]?.patch;
    expect(edit).toMatchObject({ sectionId: music.id });
    expect(edit?.rank).toBeDefined();

    // Dragging the Venue head past Music's middle puts it after Music:
    // Venue spans the hall (40..80), Music the band and the cake (80..160).
    const sectionGrip = within(todos).getByRole("button", {
      name: "Reorder section Venue",
    });
    firePointer("pointerDown", sectionGrip, 5, 60, 2);
    expect(document.querySelector(".row-drag-card")).toHaveTextContent("Venue");
    firePointer("pointerMove", document, 5, 159, 2);
    firePointer("pointerUp", document, 5, 159, 2);
    await waitFor(() =>
      expect(sectionNames(todos)).toEqual(["Music", "Venue"]),
    );
    expect(within(todos).getByRole("status")).toHaveTextContent(
      "Section Venue moved.",
    );

    // From the keyboard: the arrow keys move the gap a place, Enter drops.
    const hallGrip = within(todos).getByRole("button", {
      name: "Reorder Book the hall",
    });
    hallGrip.focus();
    await user.keyboard("{ArrowUp}");
    expect(hallGrip).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".row-gap-cell")).not.toBeNull();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(taskNames(todos)).toEqual([
        "Confirm the garden venue",
        "Call the band",
        "Order the cake",
        "Book the hall",
      ]),
    );
    expect(document.querySelector(".row-gap-cell")).toBeNull();
    const hall = (await client.getEventTodos(eventId)).items.find(
      (task) => task.displayName === "Book the hall",
    );
    expect(hall?.sectionId).toBe(music.id);
    restorePointerEvents();
  });
});

describe("sections in Expenses", () => {
  it("groups the rows with the section's total, adds into a section, and moves an expense between sections by drag", async () => {
    const restorePointerEvents = installPointerEvents();
    await openTodos(["expenses"]);
    const travel = await client.createSection(eventId, {
      view: "expenses",
      name: "Travel",
      description: "Getting there and back",
    });
    const createExpense = async (
      displayName: string,
      amount: string,
      sectionId?: string,
    ) =>
      (
        await client.createEventResource(eventId, {
          commandId: crypto.randomUUID(),
          resource: {
            objectType: "expense",
            displayName,
            amount,
            currency: "EUR",
            occurredAt: "2030-05-01T08:00:00.000Z",
            ...(sectionId === undefined ? {} : { sectionId }),
          },
        })
      ).resource;
    await createExpense("Deposit", "100");
    await createExpense("Train", "42.5", travel.id);
    await createExpense("Taxi", "7.5", travel.id);
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    const heading = await screen.findByRole("heading", { name: "Expenses" });
    const panel = within(heading)
      .getByText("Expenses")
      .closest("section") as HTMLElement;
    await within(panel).findByText("Taxi");
    const travelSection = within(panel).getByRole("region", {
      name: "Travel",
    });
    expect(
      within(travelSection).getByText("Getting there and back"),
    ).toBeVisible();
    // The section's own total, faint at the right of its head.
    expect(
      travelSection.querySelector(".section-figure")?.textContent,
    ).toContain("50.00");
    expect(within(travelSection).getByText("Train")).toBeVisible();
    expect(within(travelSection).getByText("Taxi")).toBeVisible();
    expect(within(travelSection).queryByText("Deposit")).toBeNull();

    // The section's add row opens the editor with the section chosen.
    await user.click(
      within(travelSection).getByRole("button", { name: "Add expense" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Add expense" });
    expect(within(dialog).getByLabelText("Section")).toHaveValue(travel.id);
    await user.keyboard("{Escape}");

    // Dragging the deposit's grip into Travel moves it there; its date
    // keeps its place among the rows.
    installRowLayout();
    const grip = within(panel).getByRole("button", { name: "Reorder Deposit" });
    // The loose rows come first (the deposit, then the sample expense), then
    // Travel's two; past the last row's middle the gap sits at Travel's end.
    firePointer("pointerDown", grip, 5, 20, 1);
    firePointer("pointerMove", document, 5, 155, 1);
    expect(travelSection.querySelector(".row-gap")).not.toBeNull();
    firePointer("pointerUp", document, 5, 155, 1);
    await waitFor(() =>
      expect(within(travelSection).getByText("Deposit")).toBeVisible(),
    );
    const deposit = (await client.getEventExpenses(eventId)).items.find(
      (expense) => expense.displayName === "Deposit",
    );
    expect(deposit?.sectionId).toBe(travel.id);
    expect(
      travelSection.querySelector(".section-figure")?.textContent,
    ).toContain("150.00");
    restorePointerEvents();
  });
});
