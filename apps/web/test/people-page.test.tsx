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
import { PeoplePage } from "../features/people/people-page";
import { PersonPage } from "../features/people/person-page";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/people",
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

async function openRowMenu(row: HTMLElement, entry: string) {
  const user = userEvent.setup();
  await user.click(within(row).getByRole("button", { name: /^Actions for / }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: entry }));
}

describe("PeoplePage", () => {
  it("adds people through quick add, edits from the row menu, lays them out, filters, and sorts", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <PeoplePage />
      </Providers>,
    );
    expect(await screen.findByText("No people yet")).toBeVisible();

    // Quick add creates a person with the name and keeps the field open.
    await user.click(screen.getByRole("button", { name: "Add a person" }));
    const field = screen.getByRole("textbox", { name: "New person" });
    await user.type(field, "Mira Chen{Enter}");
    const list = await screen.findByRole("list", { name: "People" });
    const mira = await within(list).findByRole("listitem", {
      name: "Mira Chen",
    });
    expect(screen.getByRole("textbox", { name: "New person" })).toHaveValue("");
    expect(list).toHaveClass("person-list");
    expect(screen.getByText("1 person loaded")).toBeInTheDocument();

    // The row menu edits: a nickname, the link to the signed-in user, an
    // email, a label, and a field.
    await openRowMenu(mira, "Edit");
    const editor = await screen.findByRole("dialog", { name: "Edit person" });
    await user.type(within(editor).getByLabelText("Nickname"), "Mira");
    await user.click(within(editor).getByLabelText("This is me"));
    await user.click(
      within(editor).getByRole("button", { name: "Add contact" }),
    );
    await user.type(
      within(editor).getByLabelText("Contact 1 value"),
      "mira@example.test",
    );
    await user.click(within(editor).getByText("Labels"));
    await user.type(within(editor).getByLabelText("New label"), "family");
    await user.click(within(editor).getByRole("button", { name: "Add label" }));
    await waitFor(() =>
      expect(
        within(editor).getByRole("checkbox", { name: "family" }),
      ).toBeChecked(),
    );
    await user.click(within(editor).getByRole("button", { name: "Add field" }));
    await user.type(within(editor).getByLabelText("Field 1 name"), "diet");
    await user.type(
      within(editor).getByLabelText("Field 1 value"),
      "Vegetarian",
    );
    await user.click(
      within(editor).getByRole("button", { name: "Save person" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edit person" })).toBeNull(),
    );
    const row = await within(list).findByRole("listitem", { name: "Mira" });
    expect(
      within(row).getByRole("link", { name: "Open Mira" }),
    ).toHaveAttribute("href", expect.stringMatching(/^\/people\//));
    expect(within(row).getByText("Mira Chen")).toBeVisible();
    expect(
      within(row).getByRole("link", { name: "mira@example.test" }),
    ).toHaveAttribute("href", "mailto:mira@example.test");
    expect(within(row).getByText("family")).toBeVisible();
    expect(within(row).getByText("This is me")).toBeVisible();

    // The row closed when the editor took its focus; a second person goes
    // in the same way, and the label filter leaves them out.
    await user.click(screen.getByRole("button", { name: "Add a person" }));
    await user.type(
      screen.getByRole("textbox", { name: "New person" }),
      "adam{Enter}",
    );
    await within(list).findByRole("listitem", { name: "adam" });
    expect(screen.getByText("2 people loaded")).toBeInTheDocument();
    const rows = () =>
      Array.from(list.children).map((item) => item.getAttribute("aria-label"));
    expect(rows()).toEqual(["adam", "Mira"]);
    await user.click(screen.getByRole("button", { name: /^Filter/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "family" }));
    await user.keyboard("{Escape}");
    expect(within(list).queryByRole("listitem", { name: "adam" })).toBeNull();
    expect(screen.getByText("1 person loaded")).toBeInTheDocument();
    // Narrowed further to people without an account, nobody is left; the
    // empty state clears both filters.
    await user.click(screen.getByRole("button", { name: /^Filter/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "No account" }));
    await user.keyboard("{Escape}");
    expect(await screen.findByText("No matching people")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    const all = await screen.findByRole("list", { name: "People" });
    expect(
      Array.from(all.children).map((item) => item.getAttribute("aria-label")),
    ).toEqual(["adam", "Mira"]);

    // Namecards show the same people, and the device remembers the layout.
    await user.click(screen.getByRole("button", { name: /^Layout/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "Namecards" }));
    const cards = await screen.findByRole("list", { name: "People" });
    expect(cards).toHaveClass("person-grid");
    expect(stored["chronelle.people-layout"]).toBe("cards");
    expect(within(cards).getByRole("listitem", { name: "Mira" })).toBeVisible();
    expect(
      within(cards).getByRole("button", { name: "Add a person" }),
    ).toBeVisible();

    // The name query asks the server.
    await user.type(screen.getByLabelText("Filter people by name"), "ada");
    expect(await screen.findByText("1 person loaded")).toBeInTheDocument();
    expect(screen.queryByText("Mira Chen")).toBeNull();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.map(([url]) => String(url))
        .some((url) => url.includes("/api/persons?") && url.includes("ada")),
    ).toBe(true);
  });
});

describe("PersonPage", () => {
  it("shows the person's details, description, and tabs, and opens the editor", async () => {
    const user = userEvent.setup();
    const created = await store.fetch("/api/persons", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Bea Long",
        nickname: "Bee",
        description: "Plans the autumn trips.",
        contacts: [{ kind: "phone", value: "+1 555 0199" }],
        customProperties: { birthday: "14 March" },
      }),
    });
    const person = (await created.json()) as { id: string };
    render(
      <Providers>
        <PersonPage personId={person.id} />
      </Providers>,
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Bee" }),
    ).toBeVisible();
    // The full name reads under the title and again among the details.
    expect(screen.getAllByText("Bea Long")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "All people" })).toHaveAttribute(
      "href",
      "/people",
    );
    const overview = screen.getByRole("tabpanel");
    expect(
      within(overview).getByRole("link", { name: "+1 555 0199" }),
    ).toHaveAttribute("href", "tel:+1 555 0199");
    expect(within(overview).getByText("birthday")).toBeVisible();
    expect(within(overview).getByText("14 March")).toBeVisible();
    expect(within(overview).getByText("Plans the autumn trips.")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Events" }));
    expect(await screen.findByText("Not part of any event yet")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Tasks" }));
    expect(await screen.findByText("No tasks assigned")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Edit person" }));
    const editor = await screen.findByRole("dialog", { name: "Edit person" });
    expect(within(editor).getByLabelText("Nickname")).toHaveValue("Bee");
  });
});
