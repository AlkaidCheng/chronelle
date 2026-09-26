// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { useNotices } from "../components/notices";
import { useAuthSession } from "../lib/auth-session";

const home = "019d6e7d-0000-7000-8000-000000000001";
const other = "019d6e7d-0000-7000-8000-000000000002";

function Switcher() {
  const { switchWorkspace, credential } = useAuthSession();
  const { post } = useNotices();
  return (
    <>
      <p>In {credential?.workspaceId}</p>
      <button
        type="button"
        onClick={() => {
          // A notice posted in the old session is lost with it; one the
          // switch carries shows in the new one.
          post({ message: "Posted before the switch" });
          switchWorkspace(other, {
            message: "Carried across the switch",
            tone: "danger",
          });
        }}
      >
        Switch
      </button>
    </>
  );
}

describe("a notice carried across a space switch", () => {
  beforeEach(() => {
    window.sessionStorage.setItem(
      "chronelle.session",
      JSON.stringify({
        accessToken: "test-session",
        workspaceId: home,
        homeWorkspaceId: home,
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async () => Response.json({})),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("shows once the new session's providers have mounted", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <Switcher />
      </Providers>,
    );
    await user.click(await screen.findByRole("button", { name: "Switch" }));
    expect(await screen.findByText(`In ${other}`)).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Carried across the switch",
    );
    expect(screen.queryByText("Posted before the switch")).toBeNull();
  });
});
