// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DateTile,
  LayoutControl,
  objectTypeLabel,
  PanelHeading,
  StatusChip,
} from "../features/events/component-frame";

afterEach(cleanup);

describe("component frame", () => {
  it("offers a kind's layouts behind one control reading the current one", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <LayoutControl
        onChange={onChange}
        view="list"
        views={["list", "by-day", "week", "month"]}
      />,
    );
    const button = screen.getByRole("button", { name: "Layout: List" });
    await user.click(button);
    expect(
      screen
        .getAllByRole("menuitemradio")
        .map((item) => [item.textContent, item.getAttribute("aria-checked")]),
    ).toEqual([
      ["List", "true"],
      ["By day", "false"],
      ["By week", "false"],
      ["Calendar", "false"],
    ]);
    await user.click(screen.getByRole("menuitemradio", { name: "List" }));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(button);
    await user.click(screen.getByRole("menuitemradio", { name: "Calendar" }));
    expect(onChange).toHaveBeenCalledWith("month");
    rerender(
      <LayoutControl
        busy
        onChange={onChange}
        view="month"
        views={["list", "by-day", "week", "month"]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Layout: Calendar" }),
    ).toBeDisabled();
    rerender(
      <LayoutControl onChange={onChange} view="list" views={["list"]} />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reads a count beside the title when the component keeps one", () => {
    render(<PanelHeading count="2 of 5 open" title="To-dos" />);
    expect(screen.getByText("2 of 5 open")).toHaveClass("panel-count");
    expect(screen.getByRole("heading", { name: "To-dos" })).toBeVisible();
  });

  it("labels statuses for reading and keeps the status class", () => {
    render(<StatusChip status="in_progress" />);
    const chip = screen.getByText("In progress");
    expect(chip).toHaveClass("status-chip", "status-in_progress");
  });

  it("shows an unknown status as stored", () => {
    render(<StatusChip status="snoozed" />);
    expect(screen.getByText("snoozed")).toHaveClass("status-snoozed");
  });

  it("marks a date with the month above the day", () => {
    render(<DateTile dateTime="2027-07-12" day="12" month="Jul" />);
    const tile = screen.getByText("JUL").closest("time");
    expect(tile).toHaveAttribute("datetime", "2027-07-12");
    expect(tile).toHaveTextContent(/^JUL12$/);
  });

  it("names object kinds the way the views do", () => {
    expect(objectTypeLabel("event")).toBe("Scheduled event");
    expect(objectTypeLabel("task")).toBe("Task");
    expect(objectTypeLabel("document")).toBe("document");
  });
});
