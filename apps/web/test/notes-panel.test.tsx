// @vitest-environment jsdom

import { ChronelleApiClient } from "@livtales/api-client";
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
import { EventComponent } from "../features/events/event-component";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/events",
}));

let store: SandboxStore;
let client: ChronelleApiClient;
let eventId: string;

beforeEach(async () => {
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

async function addNote(displayName: string, body: string) {
  const result = await client.createEventResource(eventId, {
    commandId: crypto.randomUUID(),
    resource: { objectType: "note", displayName, body },
  });
  assert(result.resource.objectType === "note");
  return result.resource;
}

describe("Notes component", () => {
  it("lists notes newest edit first, opens one in place with its links, and sorts by title", async () => {
    const dinner = await addNote(
      "Dinner with the Tanakas",
      "Gion, second alley on the left.\nThey booked under Tanaka, 19:00.\nMap: https://maps.example/tanaka-gion.",
    );
    await addNote("Ryokan house rules", "Shoes off at the entrance.");
    const user = userEvent.setup();
    render(
      <Providers>
        <EventComponent canEdit eventId={eventId} kind="notes" />
      </Providers>,
    );
    const titles = () =>
      screen
        .getAllByRole("button", { expanded: false })
        .filter((button) => button.classList.contains("note-toggle"))
        .map((button) => button.textContent);
    await screen.findByRole("heading", { level: 2, name: "Notes" });
    await waitFor(() =>
      expect(titles()).toEqual([
        "Ryokan house rules",
        "Dinner with the Tanakas",
      ]),
    );
    expect(screen.getByText("2 notes")).toBeVisible();
    // Folded, the card shows the first two lines; opened, the whole text
    // with the address a link and the full stop kept as text.
    const card = document.getElementById(`note-${dinner.id}`);
    assert(card);
    expect(within(card).getByText(/Gion, second alley/)).toHaveClass(
      "note-preview",
    );
    expect(within(card).queryByRole("link")).toBeNull();
    expect(within(card).getByText(/by Sample planner$/)).toBeVisible();
    await user.click(
      within(card).getByRole("button", { name: "Dinner with the Tanakas" }),
    );
    const link = within(card).getByRole("link", {
      name: "https://maps.example/tanaka-gion",
    });
    expect(link).toHaveAttribute("href", "https://maps.example/tanaka-gion");
    expect(link).toHaveAttribute("target", "_blank");
    expect(within(card).getByText(/They booked under Tanaka/)).toHaveClass(
      "note-body",
    );
    await user.click(
      within(card).getByRole("button", { name: "Dinner with the Tanakas" }),
    );
    expect(within(card).queryByRole("link")).toBeNull();

    // Sort by title.
    await user.click(screen.getByRole("button", { name: "Sort" }));
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitemradio", {
        name: "By title",
      }),
    );
    await waitFor(() =>
      expect(titles()).toEqual([
        "Dinner with the Tanakas",
        "Ryokan house rules",
      ]),
    );
  });

  it("adds a note from the editor, edits it in place, and moves one to Trash", async () => {
    const rules = await addNote("Ryokan house rules", "Bath 16:00 to 22:00.");
    const user = userEvent.setup();
    render(
      <Providers>
        <EventComponent canEdit eventId={eventId} kind="notes" />
      </Providers>,
    );
    await user.click(await screen.findByRole("button", { name: "Add note" }));
    const editor = await screen.findByRole("dialog", { name: "Note" });
    await user.type(within(editor).getByLabelText("Title"), "What to bring");
    await user.type(
      within(editor).getByLabelText("Text"),
      "Coins for the shrines,{enter}a folding umbrella.",
    );
    expect(
      within(editor).queryByText(/Line breaks are kept/),
    ).not.toBeInTheDocument();
    await user.click(
      within(editor).getByRole("button", { name: "About this editor" }),
    );
    expect(
      within(editor).getByText(
        "Plain text. Line breaks are kept and links open when the note is read.",
      ),
    ).toBeVisible();
    await user.keyboard("{Escape}");
    expect(
      within(editor).queryByText(/Line breaks are kept/),
    ).not.toBeInTheDocument();
    expect(
      within(editor).getByRole("button", { name: "About this editor" }),
    ).toHaveFocus();
    await user.click(within(editor).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Note" })).toBeNull(),
    );
    const bring = await screen.findByRole("button", { name: "What to bring" });
    expect(bring).toBeVisible();
    const notes = await client.getEventNotes(eventId);
    expect(notes.items.map((note) => note.displayName)).toEqual([
      "What to bring",
      "Ryokan house rules",
    ]);
    expect(notes.items[0]).toMatchObject({
      body: "Coins for the shrines,\na folding umbrella.",
      permissionScopeId: eventId,
    });

    // Edit through the row menu; the text is replaced and a version added.
    await user.click(
      screen.getByRole("button", { name: "Actions for Ryokan house rules" }),
    );
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: "Edit",
      }),
    );
    const edit = await screen.findByRole("dialog", { name: "Edit note" });
    const text = within(edit).getByLabelText("Text");
    await waitFor(() => expect(text).toHaveValue("Bath 16:00 to 22:00."));
    await user.clear(text);
    await user.type(text, "Quiet after 22:00.");
    await user.click(within(edit).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edit note" })).toBeNull(),
    );
    await waitFor(async () =>
      expect(await client.getNote(rules.id)).toMatchObject({
        body: "Quiet after 22:00.",
        version: 2,
      }),
    );

    // The lifecycle dialog opens from the menu's last entry; the sample
    // workspace offers the link's removal there, which takes the note off
    // the list (Trash itself needs the delete action the sample never grants).
    await user.click(
      screen.getByRole("button", { name: "Actions for What to bring" }),
    );
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: "Move to Trash",
      }),
    );
    const lifecycle = await screen.findByRole("dialog", {
      name: /What to bring/,
    });
    await user.click(
      await within(lifecycle).findByRole("button", {
        name: "Remove from this event",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "What to bring" }),
      ).toBeNull(),
    );
    expect((await client.getEventNotes(eventId)).items).toHaveLength(1);
  });

  it("reads only for a viewer: no add row, history alone in the menu", async () => {
    await addNote("Ryokan house rules", "Shoes off at the entrance.");
    const user = userEvent.setup();
    render(
      <Providers>
        <EventComponent canEdit={false} eventId={eventId} kind="notes" />
      </Providers>,
    );
    await screen.findByRole("button", { name: "Ryokan house rules" });
    expect(screen.queryByRole("button", { name: "Add note" })).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Actions for Ryokan house rules" }),
    );
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["History"]);
  });
});
