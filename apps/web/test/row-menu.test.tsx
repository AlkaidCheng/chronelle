// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RowMenu, type RowMenuEntry } from "../components/row-menu";

afterEach(() => {
  cleanup();
});

function entries(calls: string[]): RowMenuEntry[] {
  return [
    { kind: "action", label: "Edit", onSelect: () => calls.push("edit") },
    {
      kind: "action",
      label: "Move up",
      disabled: true,
      onSelect: () => calls.push("up"),
    },
    { kind: "rule" },
    {
      kind: "choices",
      label: "Due",
      note: "Now today",
      choices: [
        { label: "Today", checked: true, onSelect: () => calls.push("today") },
        {
          label: "Tomorrow",
          checked: false,
          onSelect: () => calls.push("tomorrow"),
        },
      ],
    },
    {
      kind: "action",
      label: "Move to Trash",
      danger: true,
      onSelect: () => calls.push("trash"),
    },
  ];
}

describe("RowMenu", () => {
  it("opens on request, runs an entry after closing, and returns focus", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    render(<RowMenu entries={entries(calls)} label="Actions for Cake" />);
    const button = screen.getByRole("button", { name: "Actions for Cake" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(button);
    const menu = screen.getByRole("menu", { name: "Actions for Cake" });
    expect(menu).toBeVisible();
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    expect(screen.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Move to Trash" })).toHaveClass(
      "is-danger",
    );
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(calls).toEqual(["edit"]);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("moves with the arrow keys, wraps, and closes on Escape", async () => {
    const user = userEvent.setup();
    render(<RowMenu entries={entries([])} label="Actions for Cake" />);
    const button = screen.getByRole("button", { name: "Actions for Cake" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    // A disabled entry is read but skipped.
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Due" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(
      screen.getByRole("menuitem", { name: "Move to Trash" }),
    ).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(
      screen.getByRole("menuitem", { name: "Move to Trash" }),
    ).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("swaps choices into the same list and brings the entries back", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    render(<RowMenu entries={entries(calls)} label="Actions for Cake" />);
    await user.click(screen.getByRole("button", { name: "Actions for Cake" }));
    const due = screen.getByRole("menuitem", { name: "Due" });
    expect(due).toHaveAttribute("aria-haspopup", "menu");
    await user.click(due);
    expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
    expect(screen.getByText("Now today")).toBeVisible();
    const today = screen.getByRole("menuitemradio", { name: "Today" });
    expect(today).toHaveAttribute("aria-checked", "true");
    expect(today).toHaveFocus();
    // Escape in the choices returns to the entries, not out of the menu.
    await user.keyboard("{Escape}");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeVisible();
    await user.keyboard("{ArrowRight}");
    await vi.waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Due" })).toHaveFocus(),
    );
    await user.keyboard("{ArrowRight}");
    await user.click(screen.getByRole("menuitemradio", { name: "Tomorrow" }));
    expect(calls).toEqual(["tomorrow"]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on a press outside without running anything", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    render(
      <>
        <p>Elsewhere</p>
        <RowMenu entries={entries(calls)} label="Actions for Cake" />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Actions for Cake" }));
    expect(screen.getByRole("menu")).toBeVisible();
    fireEvent.pointerDown(screen.getByText("Elsewhere"));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(calls).toEqual([]);
  });
});
