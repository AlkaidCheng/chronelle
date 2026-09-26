// @vitest-environment jsdom

import type { SessionResponse } from "@livtales/schemas";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { EventBreadcrumb } from "../features/events/event-breadcrumb";

const userId = "019d6e7d-0000-7000-8000-000000000002";
const personalId = "019d6e7d-0000-7000-8000-000000000001";
const weddingId = "019d6e7d-0000-7000-8000-000000000003";
const sharedId = "019d6e7d-0000-7000-8000-000000000004";

const session: SessionResponse = {
  principal: { type: "user", userId, workspaceId: personalId },
  user: {
    id: userId,
    displayName: "Planner",
    email: "planner@example.test",
    username: "planner",
    locale: null,
    timeZone: null,
    hourCycle: null,
    weekStart: null,
    rail: {},
    eventTabs: {},
  },
  workspace: { id: personalId, displayName: "Planner's workspace" },
  availableWorkspaces: [
    {
      id: personalId,
      displayName: "Planner's workspace",
      personal: true,
      ownerDisplayName: "Planner",
      role: "owner",
    },
    {
      id: weddingId,
      displayName: "Lin & Sam's wedding",
      personal: false,
      ownerDisplayName: "Sam",
      role: "editor",
    },
    {
      id: sharedId,
      displayName: "Chen Li's workspace",
      personal: false,
      ownerDisplayName: "Chen Li",
      role: null,
    },
  ],
} as unknown as SessionResponse;

async function breadcrumb(workspaceId?: string) {
  render(
    workspaceId === undefined ? (
      <EventBreadcrumb />
    ) : (
      <EventBreadcrumb workspaceId={workspaceId} />
    ),
    { wrapper: Providers },
  );
  const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
  await within(nav).findByRole("link", { name: "All events" });
  return nav;
}

describe("EventBreadcrumb", () => {
  beforeEach(() => {
    window.sessionStorage.setItem(
      "chronelle.session",
      JSON.stringify({ accessToken: "test-session", workspaceId: personalId }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify(session), {
            headers: { "content-type": "application/json" },
          }),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("names the account's own space Personal, then links to Events", async () => {
    const nav = await breadcrumb(personalId);
    expect(await within(nav).findByText("Personal")).toBeVisible();
    expect(nav).toHaveTextContent("Personal/Events");
    expect(
      within(nav).getByRole("link", { name: "All events" }),
    ).toHaveAttribute("href", "/events");
  });

  it("names a space the account belongs to by its name", async () => {
    const nav = await breadcrumb(weddingId);
    expect(await within(nav).findByText("Lin & Sam's wedding")).toBeVisible();
  });

  it("reads Shared with me for a space reached through a share alone", async () => {
    const nav = await breadcrumb(sharedId);
    expect(await within(nav).findByText("Shared with me")).toBeVisible();
    expect(nav).not.toHaveTextContent("Chen Li");
  });

  it("shows only the link while the event is unknown", async () => {
    const nav = await breadcrumb();
    expect(nav).toHaveTextContent(/^Events$/);
  });
});
