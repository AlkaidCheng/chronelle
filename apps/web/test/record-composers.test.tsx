// @vitest-environment jsdom

import { LivTalesApiClient } from "@livtales/api-client";
import {
  cleanup,
  fireEvent,
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
import { EventComponent } from "../features/events/event-component";
import { formatDateTime, fromDateTimeInput } from "../lib/format";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";
import {
  chip,
  setAmountChip,
  setMomentChip,
  setSpanChip,
} from "./record-composers";
import { chooseRowAction } from "./row-menu-support";

let store: SandboxStore;
let client: LivTalesApiClient;
let eventId: string;

beforeEach(async () => {
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
});

type Kind = "calendar" | "reminders" | "expenses" | "timeline";

function renderView(kind: Kind, canEdit = true) {
  const user = userEvent.setup();
  render(<EventComponent canEdit={canEdit} eventId={eventId} kind={kind} />, {
    wrapper: Providers,
  });
  return user;
}

const composer = (name: string | RegExp) => screen.getByRole("form", { name });
const rowPress = (name: string) =>
  screen.getByRole("button", { name: `Edit ${name}` });
const clock = (day: string, time: string) =>
  formatDateTime(fromDateTimeInput(`${day}T${time}`));

describe("the schedule item composer", () => {
  it("adds items from the add row with dates, times, and a place, and keeps the composer open", async () => {
    const user = renderView("calendar");
    await user.click(
      await screen.findByRole("button", { name: "Add schedule item" }),
    );
    const form = composer("New schedule item");
    const name = within(form).getByLabelText("Schedule item");
    expect(name).toHaveFocus();
    expect(within(form).getByLabelText("Description")).toBeVisible();
    expect(chip(/^Dates$/, form)).toBeVisible();
    expect(chip(/^Place$/, form)).toBeVisible();
    await user.type(name, "Lantern walk");
    await setSpanChip(user, "2030-11-03", { start: "18:00", end: "19:30" });
    expect(chip(/^Dates/, form)).toHaveTextContent(
      `Dates: ${clock("2030-11-03", "18:00")} to 7:30 PM`,
    );
    await user.click(chip(/^Place$/, form));
    const place = screen.getByRole("textbox", { name: "Place" });
    expect(place).toHaveFocus();
    await user.type(place, "The garden{Enter}");
    expect(chip(/^Place/, form)).toHaveTextContent("The garden");
    expect(chip(/^Place/, form)).toHaveFocus();
    await user.click(name);
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(within(form).getByRole("status")).toHaveTextContent("Added."),
    );
    expect(name).toHaveValue("");
    expect(name).toHaveFocus();
    expect(chip(/^Dates$/, form)).toBeVisible();
    const row = (
      await screen.findByRole("heading", { name: "Lantern walk" })
    ).closest("article");
    assert(row);
    expect(row).toHaveTextContent("The garden");
    const items = await client.getEventCalendar(eventId);
    expect(
      items.items.find((item) => item.displayName === "Lantern walk"),
    ).toMatchObject({
      location: "The garden",
      startsAt: fromDateTimeInput("2030-11-03T18:00"),
      endsAt: fromDateTimeInput("2030-11-03T19:30"),
    });
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("form", { name: "New schedule item" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add schedule item" }),
    ).toHaveFocus();
  });

  it("opens a row in place, saves one versioned update, and leaves it alone on Cancel", async () => {
    const user = renderView("calendar");
    await user.click(
      await screen.findByRole("button", { name: "Edit Welcome and coffee" }),
    );
    const form = composer("Edit Welcome and coffee");
    const name = within(form).getByLabelText("Schedule item");
    expect(name).toHaveValue("Welcome and coffee");
    expect(name).toHaveFocus();
    expect(chip(/^Dates/, form)).toHaveTextContent(/^Dates: /);
    await user.type(name, " and cake");
    await user.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Welcome and coffee" }),
    ).toBeVisible();

    await user.click(rowPress("Welcome and coffee"));
    const again = composer("Edit Welcome and coffee");
    await user.clear(within(again).getByLabelText("Schedule item"));
    await user.type(
      within(again).getByLabelText("Schedule item"),
      "Welcome tea",
    );
    await user.click(within(again).getByRole("button", { name: "Save" }));
    expect(
      await screen.findByRole("heading", { name: "Welcome tea" }),
    ).toBeVisible();
    expect(screen.queryByRole("form")).toBeNull();
    const items = await client.getEventCalendar(eventId);
    expect(
      items.items.find((item) => item.displayName === "Welcome tea"),
    ).toMatchObject({ version: 2 });
  });

  it("refuses a stale save with the comparison, and the row menu keeps Edit", async () => {
    const user = renderView("calendar");
    await user.click(
      await screen.findByRole("button", { name: "Edit Welcome and coffee" }),
    );
    const form = composer("Edit Welcome and coffee");
    const items = await client.getEventCalendar(eventId);
    const item = items.items.find(
      (item) => item.displayName === "Welcome and coffee",
    );
    assert(item);
    await client.updateEvent(item.id, {
      displayName: "Welcome and coffee, elsewhere",
      expectedVersion: item.version,
    });
    await user.type(within(form).getByLabelText("Schedule item"), "!");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(
      await within(form).findByRole("button", { name: /Keep mine/ }),
    ).toBeVisible();
    await user.click(within(form).getByRole("button", { name: /Keep mine/ }));
    expect(
      await screen.findByRole("heading", { name: "Welcome and coffee!" }),
    ).toBeVisible();

    const row = screen
      .getByRole("heading", { name: "Welcome and coffee!" })
      .closest("article");
    assert(row);
    await chooseRowAction(user, row, "Edit");
    expect(composer("Edit Welcome and coffee!")).toBeVisible();
  });

  it("hands its fields to the full editor from More", async () => {
    const user = renderView("calendar");
    await user.click(
      await screen.findByRole("button", { name: "Add schedule item" }),
    );
    const form = composer("New schedule item");
    await user.type(within(form).getByLabelText("Schedule item"), "Tea house");
    await user.click(within(form).getByRole("button", { name: /^More/ }));
    const dialog = await screen.findByRole("dialog", {
      name: "Add schedule item",
    });
    expect(within(dialog).getByLabelText("Schedule item")).toHaveValue(
      "Tea house",
    );
    expect(
      screen.queryByRole("form", { name: "New schedule item" }),
    ).toBeNull();
  });

  it("asks before another row opens over unsaved changes", async () => {
    const user = renderView("calendar");
    await user.click(
      await screen.findByRole("button", { name: "Add schedule item" }),
    );
    const form = composer("New schedule item");
    await user.type(within(form).getByLabelText("Schedule item"), "Draft");
    await user.click(rowPress("Welcome and coffee"));
    expect(
      within(form).getByText("This row has unsaved changes. Discard them?"),
    ).toBeVisible();
    expect(
      within(form).getByRole("button", { name: "Keep editing" }),
    ).toHaveFocus();
    await user.click(
      within(form).getByRole("button", { name: "Keep editing" }),
    );
    expect(within(form).getByLabelText("Schedule item")).toHaveValue("Draft");
    await user.click(rowPress("Welcome and coffee"));
    await user.click(within(form).getByRole("button", { name: "Discard" }));
    expect(composer("Edit Welcome and coffee")).toBeVisible();
    expect(
      screen.queryByRole("form", { name: "New schedule item" }),
    ).toBeNull();
  });
});

describe("the reminder composer", () => {
  it("adds a reminder due at nine, edits its moment in place, and keeps the row's actions", async () => {
    const user = renderView("reminders");
    await user.click(
      await screen.findByRole("button", { name: "Add a reminder to the list" }),
    );
    const form = composer("New reminder");
    expect(within(form).getByLabelText("Reminder")).toHaveFocus();
    expect(within(form).queryByLabelText("Description")).toBeNull();
    expect(chip(/^Remind at/, form)).toHaveTextContent(/9:00 AM/);
    await user.type(
      within(form).getByLabelText("Reminder"),
      "Water the lanterns",
    );
    await setMomentChip(user, /^Remind at/, "2030-11-03", "18:30");
    expect(chip(/^Remind at/, form)).toHaveTextContent(
      `Remind at: ${clock("2030-11-03", "18:30")}`,
    );
    await user.click(within(form).getByLabelText("Reminder"));
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(within(form).getByRole("status")).toHaveTextContent("Added."),
    );
    const heading = await screen.findByRole("heading", {
      name: "Water the lanterns",
    });
    expect(heading.closest("article")).toHaveTextContent(
      clock("2030-11-03", "18:30"),
    );
    await user.keyboard("{Escape}");

    await user.click(rowPress("Water the lanterns"));
    const edit = composer("Edit Water the lanterns");
    await setMomentChip(user, /^Remind at/, "2030-11-04", "08:15");
    await user.click(within(edit).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        screen
          .getByRole("heading", { name: "Water the lanterns" })
          .closest("article"),
      ).toHaveTextContent(clock("2030-11-04", "08:15")),
    );
    const row = screen
      .getByRole("heading", { name: "Water the lanterns" })
      .closest("article");
    assert(row);
    await chooseRowAction(user, row, "Dismiss");
    await waitFor(() => expect(row).toHaveTextContent("Dismissed"));
  });

  it("hands its fields to the full editor from More", async () => {
    const user = renderView("reminders");
    await user.click(
      await screen.findByRole("button", {
        name: "Edit Check the weather forecast",
      }),
    );
    const form = composer("Edit Check the weather forecast");
    await user.type(within(form).getByLabelText("Reminder"), " again");
    await user.click(within(form).getByRole("button", { name: /^More/ }));
    const dialog = await screen.findByRole("dialog", { name: "Edit reminder" });
    expect(within(dialog).getByLabelText("Reminder")).toHaveValue(
      "Check the weather forecast again",
    );
  });
});

describe("the expense composer", () => {
  it("adds an expense with its amount, currency, and day paid, and refuses one without an amount", async () => {
    const user = renderView("expenses");
    await user.click(
      await screen.findByRole("button", { name: "Add expense" }),
    );
    const form = composer("New expense");
    const name = within(form).getByLabelText("What was paid for");
    expect(name).toHaveFocus();
    expect(chip(/^Amount$/, form)).toBeVisible();
    expect(chip(/^Paid on/, form)).toHaveTextContent(/^Paid on: /);
    await user.type(name, "Lanterns");
    await user.keyboard("{Enter}");
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "Enter an amount and a three-letter currency.",
    );
    const amount = screen.getByRole("textbox", { name: "Amount" });
    expect(amount).toHaveFocus();
    fireEvent.change(amount, { target: { value: "42.5" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Currency" }), {
      target: { value: "eur" },
    });
    fireEvent.keyDown(amount, { key: "Enter" });
    expect(chip(/^Amount/, form)).toHaveTextContent(/42\.50/);
    await setMomentChip(user, /^Paid on/, "2030-11-02", "09:00");
    await user.click(name);
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(within(form).getByRole("status")).toHaveTextContent("Added."),
    );
    expect(name).toHaveValue("");
    const heading = await screen.findByRole("heading", { name: "Lanterns" });
    const row = heading.closest("article");
    assert(row);
    expect(row).toHaveTextContent(/42\.50/);
    expect(row).toHaveTextContent(clock("2030-11-02", "09:00"));
    const expenses = await client.getEventExpenses(eventId);
    expect(
      expenses.items.find((expense) => expense.displayName === "Lanterns"),
    ).toMatchObject({ amount: "42.5", currency: "EUR" });
  });

  it("edits a row's amount in place and hands its fields to the full editor from More", async () => {
    const user = renderView("expenses");
    await user.click(
      await screen.findByRole("button", { name: "Edit Venue deposit" }),
    );
    const form = composer("Edit Venue deposit");
    expect(chip(/^Amount/, form)).toHaveTextContent(/240/);
    await setAmountChip(user, "260");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        screen
          .getByRole("heading", { name: "Venue deposit" })
          .closest("article"),
      ).toHaveTextContent(/260\.00/),
    );
    await user.click(rowPress("Venue deposit"));
    const again = composer("Edit Venue deposit");
    await user.click(within(again).getByRole("button", { name: /^More/ }));
    const dialog = await screen.findByRole("dialog", { name: "Edit expense" });
    expect(within(dialog).getByLabelText("Amount")).toHaveValue("260");
  });
});

describe("the Timeline's entries", () => {
  it("opens an entry's record in place as its kind's composer", async () => {
    const user = renderView("timeline");
    await user.click(
      await screen.findByRole("button", { name: "Edit Venue deposit" }),
    );
    const form = await screen.findByRole("form", {
      name: "Edit Venue deposit",
    });
    expect(within(form).getByLabelText("What was paid for")).toHaveValue(
      "Venue deposit",
    );
    await user.type(within(form).getByLabelText("What was paid for"), " paid");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(
      await screen.findByRole("heading", { name: "Venue deposit paid" }),
    ).toBeVisible();
    expect(screen.queryByRole("form")).toBeNull();

    await user.click(rowPress("Welcome and coffee"));
    expect(
      await screen.findByRole("form", { name: "Edit Welcome and coffee" }),
    ).toBeVisible();
    await user.click(rowPress("Check the weather forecast"));
    expect(
      await screen.findByRole("form", {
        name: "Edit Check the weather forecast",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("form", { name: "Edit Welcome and coffee" }),
    ).toBeNull();
  });

  it("keeps the entries as names alone for a viewer", async () => {
    renderView("timeline", false);
    expect(
      await screen.findByRole("heading", { name: "Venue deposit" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
  });
});
