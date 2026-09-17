// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HeadMenu } from "../components/head-menu";

afterEach(cleanup);

describe("HeadMenu", () => {
  it("opens on the checked choice, chooses one, and returns focus", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <HeadMenu
        entries={[
          { kind: "radio", label: "List", checked: false, onSelect },
          { kind: "radio", label: "By day", checked: true, onSelect },
        ]}
        icon={<svg aria-hidden="true" />}
        label="Layout"
        name="By day"
      />,
    );
    const button = screen.getByRole("button", { name: "Layout: By day" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitemradio", { name: "By day" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitemradio", { name: "List" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("closes on Escape when nothing inside it holds focus", async () => {
    // A pointer press does not focus the pressed control in every browser,
    // so Escape is read from the document rather than the list.
    const user = userEvent.setup();
    render(
      <HeadMenu
        entries={[
          { kind: "check", label: "Open", checked: true, onSelect: vi.fn() },
        ]}
        icon={<svg aria-hidden="true" />}
        label="Filter"
      />,
    );
    const trigger = screen.getByRole("button", { name: "Filter" });
    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeVisible();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("keeps a filter menu open while toggling and closes on Escape or a press outside", async () => {
    const user = userEvent.setup();
    const toggle = vi.fn();
    const run = vi.fn();
    render(
      <>
        <button type="button">Elsewhere</button>
        <HeadMenu
          active
          entries={[
            { kind: "label", text: "Show" },
            { kind: "check", label: "Open", checked: true, onSelect: toggle },
            { kind: "rule" },
            { kind: "item", label: "Clear filters", onSelect: run },
          ]}
          icon={<svg aria-hidden="true" />}
          label="Filter"
          name="1 filter"
        />
      </>,
    );
    const button = screen.getByRole("button", { name: "Filter: 1 filter" });
    expect(button).toHaveClass("is-active");
    await user.click(button);
    const menu = screen.getByRole("menu", { name: "Filter" });
    expect(menu).toHaveTextContent("Show");
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Open" }));
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("menu")).toBeVisible();
    await user.keyboard("{End}");
    expect(
      screen.getByRole("menuitem", { name: "Clear filters" }),
    ).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
    await user.click(button);
    await user.click(screen.getByRole("menuitem", { name: "Clear filters" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(button);
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
