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
  it("adds a known person, creates a new one inside the event, and removes a link", async () => {
    const sam = await client.createPerson({ displayName: "Sam Lee" });
    const user = userEvent.setup();
    render(
      <Providers>
        <EventComponent canEdit eventId={eventId} kind="people" />
      </Providers>,
    );
    expect(await screen.findByText("No people yet")).toBeVisible();

    // A person the workspace knows is offered by name and included.
    await user.click(screen.getByRole("button", { name: "Add person" }));
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

    // Removing the link keeps the person in the workspace.
    await user.click(
      screen.getByRole("button", { name: "Actions for Sam Lee" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Remove context link" }),
    );
    const lifecycle = await screen.findByRole("dialog", {
      name: /Sam Lee/,
    });
    await user.click(within(lifecycle).getByRole("checkbox"));
    await user.click(
      within(lifecycle).getByRole("button", { name: "Confirm removal" }),
    );
    await waitFor(() =>
      expect(
        within(cards).queryByRole("listitem", { name: "Sam Lee" }),
      ).toBeNull(),
    );
    expect(await client.getPerson(sam.id)).toMatchObject({ deletedAt: null });
  });
});
