// @vitest-environment jsdom

import { LivTalesApiClient } from "@livtales/api-client";
import type { EventResponse } from "@livtales/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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
import { grantHasScope } from "../features/events/share-sheet";
import { narrowedViews } from "../features/events/use-event-tabs";
import { queryKeys } from "../lib/queries";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/events",
}));

let store: SandboxStore;
let client: LivTalesApiClient;
let event: EventResponse;

/** The event page's access read, as the view's controls find it. */
function KnownAccess({ actions }: { readonly actions: readonly string[] }) {
  const cache = useQueryClient();
  useState(() =>
    cache.setQueryData(queryKeys.access(event.id), {
      resourceId: event.id,
      actions,
      source: { kind: "own" },
      narrowing: null,
    }),
  );
  return null;
}

beforeEach(async () => {
  let snapshot: string | null = null;
  store = new SandboxStore({
    getItem: () => snapshot,
    setItem: (_key, value) => {
      snapshot = value;
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
  const found = events.items.find(
    (candidate) => candidate.displayName === "Autumn gathering",
  );
  assert(found);
  event = found;
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
});

function renderTodos(actions: readonly string[] = ["view", "edit", "share"]) {
  return render(
    <Providers>
      <KnownAccess actions={actions} />
      <EventComponent canEdit eventId={event.id} kind="todos" />
    </Providers>,
  );
}

describe("grantHasScope", () => {
  it("matches the view and the section exactly", () => {
    const todos = { view: "todos" as const, sectionId: null };
    expect(grantHasScope({ scope: todos }, todos)).toBe(true);
    expect(grantHasScope({ scope: null }, todos)).toBe(false);
    expect(
      grantHasScope({ scope: { view: "todos", sectionId: "s1" } }, todos),
    ).toBe(false);
    expect(
      grantHasScope({ scope: { view: "expenses", sectionId: null } }, todos),
    ).toBe(false);
  });
});

describe("narrowedViews", () => {
  it("lists the shared views and the views holding a shared section", () => {
    expect(narrowedViews(null)).toBeNull();
    expect(
      narrowedViews({
        views: ["reminders"],
        sections: [{ id: "s1", view: "todos" }],
      }),
    ).toEqual(new Set(["reminders", "todos"]));
  });
});

describe("the Share control", () => {
  it("shares the view with a friend at a role, changes it, and removes it", async () => {
    const user = userEvent.setup();
    renderTodos();
    const share = await screen.findByRole("button", { name: /^Share$/ });
    await user.click(share);
    const sheet = screen.getByRole("dialog", { name: "Share To-dos" });
    expect(sheet).toHaveTextContent("Only you see this so far.");
    expect(sheet).toHaveTextContent(
      "Everyone here sees To-dos of this event, and its sections unless a section is shared on its own.",
    );

    // Add people unfolds the picker; a friend is shared at once.
    await user.click(within(sheet).getByRole("button", { name: "Add people" }));
    const friends = within(
      await within(sheet).findByRole("list", { name: "Friends" }),
    );
    await user.click(friends.getByRole("checkbox", { name: /Mei Lin/ }));
    await user.click(
      within(sheet).getByRole("button", { name: /^Share with 1 person/ }),
    );
    expect(
      await within(sheet).findByRole("combobox", { name: "Role for Mei Lin" }),
    ).toHaveValue("viewer");
    const grants = await client.listShares(event.id);
    expect(grants.items.map((grant) => [grant.role, grant.scope])).toEqual([
      ["viewer", { view: "todos", sectionId: null }],
    ]);

    // The role changes in place; the grant keeps its scope.
    await user.selectOptions(
      within(sheet).getByRole("combobox", { name: "Role for Mei Lin" }),
      "editor",
    );
    await vi.waitFor(async () => {
      const updated = await client.listShares(event.id);
      expect(updated.items.map((grant) => [grant.role, grant.scope])).toEqual([
        ["editor", { view: "todos", sectionId: null }],
      ]);
    });

    await user.click(
      within(sheet).getByRole("button", { name: "Remove Mei Lin" }),
    );
    await vi.waitFor(async () => {
      expect((await client.listShares(event.id)).items).toEqual([]);
    });
    expect(
      await within(sheet).findByText("Only you see this so far."),
    ).toBeVisible();

    // Done closes the sheet and returns focus to the control.
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Share To-dos" })).toBeNull();
    expect(share).toHaveFocus();
  });

  it("is absent for an account that may not share", async () => {
    renderTodos(["view", "edit"]);
    await screen.findByRole("button", { name: "Export" });
    expect(screen.queryByRole("button", { name: /^Share$/ })).toBeNull();
  });
});
