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

describe("PeoplePage", () => {
  it("adds people with fields, shows namecards, hides a field, edits, and filters", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <PeoplePage />
      </Providers>,
    );
    expect(await screen.findByText("No people yet")).toBeVisible();

    // A person with a nickname, an email and a phone, a label, a field, and
    // the link to the signed-in user.
    await user.click(screen.getByRole("button", { name: "New person" }));
    const editor = await screen.findByRole("dialog", { name: "Add person" });
    await user.type(within(editor).getByLabelText("Name"), "Mira Chen");
    await user.type(within(editor).getByLabelText("Nickname"), "Mira");
    await user.click(within(editor).getByLabelText("This is me"));
    await user.click(
      within(editor).getByRole("button", { name: "Add contact" }),
    );
    await user.type(
      within(editor).getByLabelText("Contact 1 value"),
      "mira@example.test",
    );
    await user.click(
      within(editor).getByRole("button", { name: "Add contact" }),
    );
    await user.selectOptions(
      within(editor).getByLabelText("Contact 2 kind"),
      "phone",
    );
    await user.type(
      within(editor).getByLabelText("Contact 2 value"),
      "+1 555 0100",
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
      within(editor).getByRole("button", { name: "Add person" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add person" })).toBeNull(),
    );
    const cards = await screen.findByRole("list", { name: "People" });
    const mira = within(cards).getByRole("listitem", { name: "Mira" });
    expect(within(mira).getByRole("heading")).toHaveTextContent("Mira (me)");
    expect(within(mira).getByText("Mira Chen")).toBeVisible();
    expect(
      within(mira).getByRole("link", { name: "mira@example.test" }),
    ).toHaveAttribute("href", "mailto:mira@example.test");
    expect(
      within(mira).getByRole("link", { name: "+1 555 0100" }),
    ).toHaveAttribute("href", "tel:+1 555 0100");
    expect(
      within(within(mira).getByRole("list", { name: "Labels" })).getByText(
        "family",
      ),
    ).toBeVisible();
    expect(within(mira).getByText("Vegetarian")).toBeVisible();
    expect(screen.getByText("1 person loaded")).toBeVisible();

    // A second person; the diet field can be hidden across the page and the
    // choice is remembered on this device.
    await user.click(screen.getByRole("button", { name: "New person" }));
    const second = await screen.findByRole("dialog", { name: "Add person" });
    await user.type(within(second).getByLabelText("Name"), "adam");
    // The signed-in user already has a person, so the link is not offered.
    expect(within(second).getByLabelText(/This is me/)).toBeDisabled();
    await user.click(
      within(second).getByRole("button", { name: "Add person" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add person" })).toBeNull(),
    );
    expect(await screen.findByText("2 people loaded")).toBeVisible();
    expect(
      within(cards)
        .getAllByRole("heading")
        .map((heading) => heading.textContent),
    ).toEqual(["adam", "Mira (me)"]);
    await user.click(screen.getByText("Shown fields"));
    await user.click(screen.getByRole("checkbox", { name: "diet" }));
    expect(screen.queryByText("Vegetarian")).toBeNull();
    expect(JSON.parse(stored["chronelle.people-fields"] ?? "[]")).toEqual([
      "diet",
    ]);
    await user.click(screen.getByRole("checkbox", { name: "diet" }));
    expect(screen.getByText("Vegetarian")).toBeVisible();

    // Editing removes a contact, changes a field's value, and keeps the rest.
    await user.click(screen.getByRole("button", { name: "Edit Mira" }));
    const edit = await screen.findByRole("dialog", { name: "Edit person" });
    expect(within(edit).getByLabelText("Nickname")).toHaveValue("Mira");
    await user.click(
      within(edit).getByRole("button", { name: "Remove contact 2" }),
    );
    const value = within(edit).getByLabelText("Field 1 value");
    await user.clear(value);
    await user.type(value, "Vegetarian dishes");
    await user.click(within(edit).getByRole("button", { name: "Save person" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edit person" })).toBeNull(),
    );
    expect(await screen.findByText("Vegetarian dishes")).toBeVisible();
    expect(screen.queryByText("+1 555 0100")).toBeNull();
    expect(
      within(within(cards).getByRole("listitem", { name: "Mira" })).getByRole(
        "link",
        { name: "mira@example.test" },
      ),
    ).toBeVisible();

    // The name query asks the server.
    await user.type(screen.getByLabelText("Filter people by name"), "ada");
    expect(await screen.findByText("1 person loaded")).toBeVisible();
    expect(screen.queryByText("Mira Chen")).toBeNull();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.map(([url]) => String(url))
        .some((url) => /^\/api\/persons\?query=ada/.test(url)),
    ).toBe(true);
  });
});
