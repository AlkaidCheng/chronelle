// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { describeDue, DuePicker } from "../components/due-picker";
import { parseDayKey } from "../lib/day-placement";

// 2030-03-05 is a Tuesday.
const now = parseDayKey("2030-03-05");
const day = (key: string) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parseDayKey(key));
const exact = (key: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parseDayKey(key));
const monthName = (key: string) =>
  new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
    parseDayKey(`${key}-01`),
  );

function Harness({
  dueDate = "",
  dueTime = "",
  duration = "",
}: {
  readonly dueDate?: string;
  readonly dueTime?: string;
  readonly duration?: string;
}) {
  const [due, setDue] = useState({ dueDate, dueTime, duration });
  return (
    <>
      <DuePicker
        dueDate={due.dueDate}
        dueTime={due.dueTime}
        duration={due.duration}
        now={now}
        onChange={setDue}
      />
      <output aria-label="Due fields">{JSON.stringify(due)}</output>
    </>
  );
}

const fields = () =>
  JSON.parse(
    screen.getByRole("status", { name: "Due fields" }).textContent ?? "",
  ) as {
    dueDate: string;
    dueTime: string;
    duration: string;
  };
const month = (key: string) =>
  within(screen.getByRole("table", { name: monthName(key) }));
const summary = () => screen.getByText(/^Due: /);

afterEach(cleanup);

describe("DuePicker", () => {
  it("reads the choice on the closed control as an exact date", () => {
    expect(describeDue("", "", "", now)).toBe("No date");
    expect(describeDue("2030-03-05", "", "", now)).toBe(
      `${exact("2030-03-05")} (today)`,
    );
    expect(describeDue("2030-03-06", "21:00", "", now)).toMatch(
      new RegExp(`^${exact("2030-03-06")} \\(tomorrow\\), 9:00 PM$`),
    );
    expect(describeDue("2030-03-06", "21:00", "90", now)).toMatch(
      /, 9:00 PM, 1 h 30 min$/,
    );
    expect(describeDue("2030-03-21", "", "", now)).toBe(exact("2030-03-21"));
  });

  it("keeps every shortcut, marks the chosen one, and fills the exact date", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByText("Due: No date")).toBeVisible();
    await user.click(screen.getByText("Due: No date"));
    const shortcuts = within(
      screen.getByRole("list", { name: "Due shortcuts" }),
    );
    // The first span of each button is its label; the second the weekday.
    const labels = () =>
      shortcuts
        .getAllByRole("button")
        .map((button) => button.querySelector("span")?.textContent);
    expect(labels()).toEqual([
      "Today",
      "Tomorrow",
      "Later this week",
      "This weekend",
      "Next week",
      "No date",
    ]);
    expect(shortcuts.getByRole("button", { name: "No date" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(shortcuts.getByRole("button", { name: /^Today/ }));
    expect(fields()).toEqual({
      dueDate: "2030-03-05",
      dueTime: "",
      duration: "",
    });
    // Today stays offered and reads as pressed; the field shows the date itself.
    expect(labels()).toHaveLength(6);
    expect(shortcuts.getByRole("button", { name: /^Today/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(shortcuts.getByRole("button", { name: "No date" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByLabelText("Due date")).toHaveValue(exact("2030-03-05"));
    expect(summary()).toHaveTextContent(`Due: ${exact("2030-03-05")} (today)`);
    await user.click(shortcuts.getByRole("button", { name: /^This weekend/ }));
    expect(fields().dueDate).toBe("2030-03-09");
    const grid = month("2030-03");
    expect(
      grid.getByRole("button", { name: day("2030-03-09") }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(grid.getByRole("button", { name: day("2030-03-05") })).toHaveClass(
      "is-today",
    );
    expect(grid.getByRole("button", { name: day("2030-03-04") })).toHaveClass(
      "is-past",
    );
    expect(grid.getByRole("button", { name: day("2030-03-09") })).toHaveClass(
      "is-weekend",
    );
    // Typed text: a readable date moves the choice; unreadable text keeps it.
    await user.clear(screen.getByLabelText("Due date"));
    await user.type(screen.getByLabelText("Due date"), "Apr 2");
    expect(fields().dueDate).toBe("2030-04-02");
    await user.type(screen.getByLabelText("Due date"), "x");
    expect(screen.getByLabelText("Due date")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(fields().dueDate).toBe("2030-04-02");
    await user.click(shortcuts.getByRole("button", { name: "No date" }));
    expect(fields()).toEqual({ dueDate: "", dueTime: "", duration: "" });
    expect(screen.getByLabelText("Due date")).toHaveValue("");
  });

  it("lists months continuously and opens a chooser for the month and year", async () => {
    const user = userEvent.setup();
    render(<Harness dueDate="2030-03-05" />);
    await user.click(summary());
    // Several months are listed at once; a day appears once.
    expect(screen.getAllByRole("table").length).toBeGreaterThan(3);
    expect(
      month("2030-04").queryByRole("button", { name: day("2030-03-31") }),
    ).toBeNull();
    expect(
      month("2030-04").getByRole("button", { name: day("2030-04-01") }),
    ).toBeVisible();
    // The heading names the month at the top and opens the chooser.
    const heading = screen.getByRole("button", {
      name: `Choose a month and year, showing ${monthName("2030-03")}`,
    });
    expect(screen.getByRole("button", { name: "Today" })).toBeDisabled();
    await user.click(heading);
    const chooser = within(
      screen.getByRole("dialog", { name: "Choose a month and year" }),
    );
    expect(screen.getByLabelText("Month and year")).toHaveValue(
      monthName("2030-03"),
    );
    const months = () => within(chooser.getByRole("group", { name: "Month" }));
    const years = () => within(chooser.getByRole("group", { name: "Year" }));
    const shortMonth = (key: string) =>
      new Intl.DateTimeFormat(undefined, { month: "short" }).format(
        parseDayKey(`${key}-01`),
      );
    expect(months().getByRole("button", { pressed: true })).toHaveTextContent(
      shortMonth("2030-03"),
    );
    expect(years().getByRole("button", { pressed: true })).toHaveTextContent(
      "2030",
    );
    // A typed month moves the list.
    await user.clear(screen.getByLabelText("Month and year"));
    await user.type(screen.getByLabelText("Month and year"), "October 2027");
    expect(
      month("2027-10").getByRole("button", { name: day("2027-10-01") }),
    ).toBeVisible();
    // The month and the year are chosen independently: each keeps the
    // chooser open, moves the list behind it, and reads back the result.
    await user.click(years().getByRole("button", { name: "2031" }));
    expect(
      month("2031-10").getByRole("button", { name: day("2031-10-01") }),
    ).toBeVisible();
    await user.click(
      months().getByRole("button", { name: shortMonth("2031-12") }),
    );
    expect(
      month("2031-12").getByRole("button", { name: day("2031-12-01") }),
    ).toBeVisible();
    expect(
      screen.getByRole("dialog", { name: "Choose a month and year" }),
    ).toBeVisible();
    expect(months().getByRole("button", { pressed: true })).toHaveTextContent(
      shortMonth("2031-12"),
    );
    expect(years().getByRole("button", { pressed: true })).toHaveTextContent(
      "2031",
    );
    await user.click(chooser.getByRole("button", { name: "Done" }));
    expect(
      screen.queryByRole("dialog", { name: "Choose a month and year" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: `Choose a month and year, showing ${monthName("2031-12")}`,
      }),
    ).toBeVisible();
    // Escape closes it too.
    await user.click(
      screen.getByRole("button", {
        name: `Choose a month and year, showing ${monthName("2031-12")}`,
      }),
    );
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Choose a month and year" }),
    ).toBeNull();
    // Today brings the list back to this month.
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(
      screen.getByRole("button", {
        name: `Choose a month and year, showing ${monthName("2030-03")}`,
      }),
    ).toBeVisible();
  });

  it("moves through the months from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness dueDate="2030-03-05" />);
    await user.click(summary());
    month("2030-03")
      .getByRole("button", { name: day("2030-03-05") })
      .focus();
    await user.keyboard("{ArrowRight}{ArrowDown}");
    expect(
      month("2030-03").getByRole("button", { name: day("2030-03-13") }),
    ).toHaveFocus();
    await user.keyboard("{Home}");
    expect(
      month("2030-03").getByRole("button", { name: day("2030-03-10") }),
    ).toHaveFocus();
    await user.keyboard("{End}{PageDown}");
    expect(
      month("2030-04").getByRole("button", { name: day("2030-04-16") }),
    ).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(fields().dueDate).toBe("2030-04-16");
    // Crossing into the previous month keeps moving; the list extends as needed.
    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
    expect(
      month("2030-03").getByRole("button", { name: day("2030-03-26") }),
    ).toHaveFocus();
  });

  it("keeps the time off until asked for and clears it with the date", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(summary());
    expect(screen.getByRole("button", { name: "Add time" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /^Tomorrow/ }));
    await user.click(screen.getByRole("button", { name: "Add time" }));
    expect(screen.getByLabelText("Duration")).toBeDisabled();
    await user.type(screen.getByLabelText("Due time"), "21:00");
    expect(fields()).toEqual({
      dueDate: "2030-03-06",
      dueTime: "21:00",
      duration: "",
    });
    expect(summary()).toHaveTextContent(
      `Due: ${exact("2030-03-06")} (tomorrow), 9:00 PM`,
    );
    await user.selectOptions(screen.getByLabelText("Duration"), "90");
    expect(fields().duration).toBe("90");
    expect(summary()).toHaveTextContent(/, 9:00 PM, 1 h 30 min$/);
    await user.click(screen.getByRole("button", { name: "Remove time" }));
    expect(fields()).toEqual({
      dueDate: "2030-03-06",
      dueTime: "",
      duration: "",
    });
    expect(screen.queryByLabelText("Due time")).toBeNull();
    expect(screen.queryByLabelText("Duration")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add time" }));
    await user.type(screen.getByLabelText("Due time"), "08:30");
    await user.selectOptions(screen.getByLabelText("Duration"), "30");
    await user.click(screen.getByRole("button", { name: "No date" }));
    expect(fields()).toEqual({ dueDate: "", dueTime: "", duration: "" });
  });
});
