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

    // A person with an email, a field, and the link to the signed-in user.
    await user.click(screen.getByRole("button", { name: "New person" }));
    const editor = await screen.findByRole("dialog", { name: "Add person" });
    await user.type(within(editor).getByLabelText("Name"), "Mira Chen");
    await user.type(
      within(editor).getByLabelText("Email"),
      "mira@example.test",
    );
    await user.click(within(editor).getByLabelText("This is me"));
    await user.click(within(editor).getByRole("button", { name: "Add field" }));
    await user.type(within(editor).getByLabelText("Field 1 name"), "phone");
    await user.type(
      within(editor).getByLabelText("Field 1 value"),
      "+1 555 0100",
    );
    await user.click(
      within(editor).getByRole("button", { name: "Add person" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add person" })).toBeNull(),
    );
    const cards = await screen.findByRole("list", { name: "People" });
    const mira = within(cards).getByRole("listitem", { name: /Mira Chen/ });
    expect(within(mira).getByRole("heading")).toHaveTextContent(
      "Mira Chen (me)",
    );
    expect(
      within(mira).getByRole("link", { name: "mira@example.test" }),
    ).toHaveAttribute("href", "mailto:mira@example.test");
    expect(within(mira).getByText("+1 555 0100")).toBeVisible();
    expect(screen.getByText("1 person loaded")).toBeVisible();

    // A second person; the phone field can be hidden across the page and the
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
    ).toEqual(["adam", "Mira Chen (me)"]);
    await user.click(screen.getByText("Shown fields"));
    await user.click(screen.getByRole("checkbox", { name: "phone" }));
    expect(screen.queryByText("+1 555 0100")).toBeNull();
    expect(JSON.parse(stored["chronelle.people-fields"] ?? "[]")).toEqual([
      "phone",
    ]);
    await user.click(screen.getByRole("checkbox", { name: "phone" }));
    expect(screen.getByText("+1 555 0100")).toBeVisible();

    // Editing changes a field's value and keeps the rest.
    await user.click(screen.getByRole("button", { name: "Edit Mira Chen" }));
    const edit = await screen.findByRole("dialog", { name: "Edit person" });
    const value = within(edit).getByLabelText("Field 1 value");
    await user.clear(value);
    await user.type(value, "+1 555 0199");
    await user.click(within(edit).getByRole("button", { name: "Save person" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edit person" })).toBeNull(),
    );
    expect(await screen.findByText("+1 555 0199")).toBeVisible();

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
