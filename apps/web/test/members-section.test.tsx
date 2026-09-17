// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { MembersSection } from "../features/settings/members-section";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

let store: SandboxStore;
let saved: string | null;
const requests: { method: string; path: string; body: unknown }[] = [];

beforeEach(() => {
  saved = null;
  store = new SandboxStore({
    getItem: () => saved,
    setItem: (_key, value) => {
      saved = value;
    },
  });
  requests.length = 0;
  vi.stubGlobal("localStorage", window.sessionStorage);
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({ accessToken: "sample", workspaceId: sandboxWorkspaceId }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>((input, options) => {
      requests.push({
        method: options?.method ?? "GET",
        path: new URL(String(input), "https://sandbox.invalid").pathname,
        body: options?.body ? JSON.parse(String(options.body)) : undefined,
      });
      return store.fetch(input, options);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

const wrapper = ({ children }: { readonly children: ReactNode }) => (
  <Providers>{children}</Providers>
);

describe("the Members section", () => {
  it("lists the members, adds a friend as viewer, and removes them", async () => {
    const user = userEvent.setup();
    render(<MembersSection />, { wrapper });
    const list = within(await screen.findByRole("list", { name: "Members" }));
    expect(list.getAllByRole("listitem")).toHaveLength(1);
    expect(list.getByText("Sample planner")).toBeVisible();
    expect(list.getByText(/Personal workspace/)).toBeVisible();
    expect(list.queryByRole("button", { name: "Remove member" })).toBeNull();

    // The friend list offers Mei; adding her lists her as a viewer.
    const friend = screen.getByRole("combobox", { name: "Friend" });
    expect(
      within(friend).getByRole("option", { name: /Mei Lin/ }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await list.findByText("Mei Lin")).toBeVisible();
    expect(list.getAllByRole("listitem")).toHaveLength(2);
    expect(list.getByText("Viewer")).toBeVisible();
    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/workspaces/current/members",
      body: {
        friendId: "00000000-0000-4000-8000-0000000000f1",
        role: "viewer",
      },
    });
    // With every friend a member, nothing is left to add.
    expect(
      await screen.findByText("Befriend someone first to add them here."),
    ).toBeVisible();

    await user.click(list.getByRole("button", { name: "Remove member" }));
    await user.click(list.getByRole("button", { name: "Remove member" }));
    expect(
      await screen.findByRole("combobox", { name: "Friend" }),
    ).toBeVisible();
    expect(list.getAllByRole("listitem")).toHaveLength(1);
    expect(requests).toContainEqual({
      method: "DELETE",
      path: "/api/workspaces/current/members/00000000-0000-4000-8000-000000000003",
      body: undefined,
    });
  });
});
