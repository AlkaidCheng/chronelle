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

describe("People component", () => {
  it("offers owners to share the event with everyone it involves", async () => {
    // A person linked to the sample account's friend Mei, one with only an
    // email, and one with neither.
    await client.createEventResource(eventId, {
      commandId: crypto.randomUUID(),
      resource: {
        objectType: "person",
        displayName: "Mei Lin",
        userId: "00000000-0000-4000-8000-000000000003",
      },
    });
    const sam = await client.createEventResource(eventId, {
      commandId: crypto.randomUUID(),
      resource: {
        objectType: "person",
        displayName: "Sam Lee",
        contacts: [{ kind: "email", value: "sam@example.com" }],
      },
    });
    await client.createEventResource(eventId, {
      commandId: crypto.randomUUID(),
      resource: { objectType: "person", displayName: "No account" },
    });
    // The sandbox grants no share access by itself; answer that.
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (input, options) => {
        const path = String(input);
        if (path === `/api/objects/${eventId}/access`)
          return Response.json({
            resourceId: eventId,
            actions: ["view", "edit", "share"],
            source: { kind: "own" },
          });
        return store.fetch(input, options);
      }),
    );
    const user = userEvent.setup();
    render(
      <Providers>
        <EventComponent canEdit eventId={eventId} kind="people" />
      </Providers>,
    );
    await user.click(
      await screen.findByText("Share with everyone here", {
        selector: "summary",
      }),
    );
    // Mei is offered under Friends, Sam and the person with neither under
    // the other people, all ticked; the last would be invited by a link.
    const friends = within(
      await screen.findByRole("list", { name: "Friends" }),
    );
    const others = within(
      screen.getByRole("list", { name: "Others in People" }),
    );
    expect(friends.getByRole("checkbox", { name: /Mei Lin/ })).toBeChecked();
    expect(others.getByRole("checkbox", { name: /Sam Lee/ })).toBeChecked();
    const nobody = others.getByRole("checkbox", { name: /No account/ });
    expect(nobody).toBeChecked();
    expect(
      within(nobody.closest("li") as HTMLElement).getByText(
        "No email; you send them the link",
      ),
    ).toBeVisible();
    // Only Mei and Sam stay ticked.
    for (const box of others.getAllByRole("checkbox")) {
      const row = box.closest("li");
      if (row !== null && !/Sam Lee/.test(row.textContent ?? ""))
        await user.click(box);
    }
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Access for Mei Lin" }),
      "owner",
    );
    await user.click(
      screen.getByRole("button", { name: "Share with 2 people" }),
    );
    // Mei holds the grant at once; Sam's share waits on the invitation the
    // tick sent to his email.
    expect(await friends.findByText("Shared as Owner")).toBeVisible();
    expect(
      await others.findByText("Invitation sent; access follows when they join"),
    ).toBeVisible();
    const shares = await client.listShares(eventId);
    expect(shares.items).toMatchObject([
      {
        principal: { id: "00000000-0000-4000-8000-000000000003" },
        role: "owner",
      },
    ]);
    expect(shares.pending).toMatchObject([
      { person: { id: sam.resource.id }, role: "viewer", kind: "invitation" },
    ]);
  });

  it("adds a known person, creates a new one inside the event, and removes a link", async () => {
    const sam = await client.createPerson({ displayName: "Sam Lee" });
    const user = userEvent.setup();
    render(
      <Providers>
        <EventComponent canEdit eventId={eventId} kind="people" />
      </Providers>,
    );
    // An editable empty collection is its add row alone.
    const addPerson = await screen.findByRole("button", { name: "Add person" });
    expect(screen.queryByText("No people yet")).toBeNull();

    // A person the workspace knows is offered by name and included.
    await user.click(addPerson);
    const dialog = await screen.findByRole("dialog", { name: "Add person" });
    await user.click(
      await within(dialog).findByRole("button", { name: "Add Sam Lee" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add person" })).toBeNull(),
    );
    const cards = await screen.findByRole("list", { name: "People" });
    expect(
      within(cards).getByRole("listitem", { name: "Sam Lee" }),
    ).toBeVisible();

    // A new person is created inside the event; the known one is no longer
    // offered.
    await user.click(screen.getByRole("button", { name: "Add person" }));
    const again = await screen.findByRole("dialog", { name: "Add person" });
    expect(
      await within(again).findByText(
        "Everyone the workspace knows is already here.",
      ),
    ).toBeVisible();
    await user.type(within(again).getByLabelText("New person"), "Mira");
    await user.click(
      within(again).getByRole("button", { name: "Add new person" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add person" })).toBeNull(),
    );
    expect(
      (await within(cards).findAllByRole("listitem")).map((item) =>
        item.getAttribute("aria-label"),
      ),
    ).toEqual(["Mira", "Sam Lee"]);
    const mira = (await client.listPersons({ query: "Mira" })).items[0];
    assert(mira);
    expect(mira.permissionScopeId).toBe(eventId);

    // Removing the link, from the card's menu, keeps the person in the workspace.
    await user.click(
      screen.getByRole("button", { name: "Actions for Sam Lee" }),
    );
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: "Move to Trash",
      }),
    );
    const lifecycle = await screen.findByRole("dialog", {
      name: /Sam Lee/,
    });
    await user.click(
      within(lifecycle).getByRole("button", { name: "Remove from this event" }),
    );
    await waitFor(() =>
      expect(
        within(cards).queryByRole("listitem", { name: "Sam Lee" }),
      ).toBeNull(),
    );
    expect(await client.getPerson(sam.id)).toMatchObject({ deletedAt: null });
  });
});
