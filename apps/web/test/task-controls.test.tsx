// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  activeFilterCount,
  defaultTaskFilters,
  TaskFilterControl,
  TaskSortControl,
} from "../features/tasks/task-controls";

afterEach(cleanup);

describe("task controls", () => {
  it("reads Sort until another order is chosen, then names it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <TaskSortControl onChange={onChange} sort="due" />,
    );
    const button = screen.getByRole("button", { name: "Sort" });
    expect(button).not.toHaveClass("is-active");
    await user.click(button);
    expect(
      screen
        .getAllByRole("menuitemradio")
        .map((item) => [item.textContent, item.getAttribute("aria-checked")]),
    ).toEqual([
      ["Manual", "false"],
      ["By due", "true"],
      ["By name", "false"],
      ["By updated", "false"],
    ]);
    await user.click(screen.getByRole("menuitemradio", { name: "By name" }));
    expect(onChange).toHaveBeenCalledWith("name");
    rerender(<TaskSortControl onChange={onChange} sort="name" />);
    expect(screen.getByRole("button", { name: "Sort: By name" })).toHaveClass(
      "is-active",
    );
  });

  it("counts the filters, offers only what the container knows, and clears them", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const filters = {
      ...defaultTaskFilters,
      status: "all" as const,
      label: "urgent",
      timed: false,
      overdue: false,
    };
    render(
      <TaskFilterControl
        assignees={[{ id: "mira", name: "Mira" }]}
        filters={filters}
        labels={[{ id: "urgent", name: "Urgent" }]}
        me={{ id: "me" }}
        onChange={onChange}
      />,
    );
    expect(activeFilterCount(filters)).toBe(2);
    const button = screen.getByRole("button", { name: "Filter: 2 filters" });
    expect(button).toHaveClass("is-active");
    await user.click(button);
    const menu = screen.getByRole("menu", { name: "Filter" });
    expect(
      [...menu.querySelectorAll("[role^='menuitem']")].map(
        (item) => item.textContent,
      ),
    ).toEqual([
      "Open",
      "All",
      "Done",
      "Has a time",
      "Overdue",
      "Any label",
      "Urgent",
      "Anyone",
      "Me",
      "Mira",
      "Clear filters",
    ]);
    expect(screen.getByRole("menuitemradio", { name: "All" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen.getByRole("menuitemradio", { name: "Urgent" }),
    ).toHaveAttribute("aria-checked", "true");
    // A choice keeps the menu open and changes one field.
    await user.click(screen.getByRole("menuitemradio", { name: "Me" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...filters, assignee: "me" });
    expect(screen.getByRole("menu")).toBeVisible();
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Overdue" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...filters, overdue: true });
    await user.click(screen.getByRole("menuitem", { name: "Clear filters" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultTaskFilters,
      timed: false,
      overdue: false,
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("leaves out the toggles, labels, and people a container does not offer", async () => {
    const user = userEvent.setup();
    render(
      <TaskFilterControl
        assignees={[]}
        filters={defaultTaskFilters}
        labels={[]}
        onChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Filter" }));
    expect(
      [...screen.getByRole("menu").querySelectorAll("[role^='menuitem']")].map(
        (item) => item.textContent,
      ),
    ).toEqual(["Open", "All", "Done", "Clear filters"]);
  });
});
