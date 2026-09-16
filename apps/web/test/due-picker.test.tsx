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

afterEach(cleanup);

describe("DuePicker", () => {
  it("reads the choice on the closed control", () => {
    expect(describeDue("", "", "", now)).toBe("No date");
    expect(describeDue("2030-03-05", "", "", now)).toBe("Today");
    expect(describeDue("2030-03-06", "21:00", "", now)).toMatch(
      /^Tomorrow, 9:00 PM$/,
    );
    expect(describeDue("2030-03-06", "21:00", "90", now)).toMatch(
      /^Tomorrow, 9:00 PM, 1 h 30 min$/,
    );
    expect(describeDue("2030-03-21", "", "", now)).toBe(
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
      }).format(parseDayKey("2030-03-21")),
    );
  });

  it("chooses a day from a shortcut, the grid, or typed text, and clears it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByText("Due: No date")).toBeVisible();
    await user.click(screen.getByText("Due: No date"));
    const shortcuts = within(
      screen.getByRole("list", { name: "Due shortcuts" }),
    );
    expect(
      shortcuts.getAllByRole("button").map((button) => button.textContent),
    ).toEqual([
      expect.stringMatching(/^Today/),
      expect.stringMatching(/^Tomorrow/),
      expect.stringMatching(/^Later this week/),
      expect.stringMatching(/^This weekend/),
      expect.stringMatching(/^Next week/),
    ]);
    await user.click(shortcuts.getByRole("button", { name: /^This weekend/ }));
    expect(fields()).toEqual({
      dueDate: "2030-03-09",
      dueTime: "",
      duration: "",
    });
    expect(screen.getByText(/^Due: /)).toHaveTextContent(/^Due: Mar 9$/);
    // Today is offered again, No date appears, the grid marks the day.
    expect(shortcuts.getByRole("button", { name: /^Today/ })).toBeVisible();
    const grid = within(screen.getByRole("table"));
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
    await user.click(grid.getByRole("button", { name: day("2030-03-20") }));
    expect(fields().dueDate).toBe("2030-03-20");
    expect(screen.getByLabelText("Due date")).toHaveValue(
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
      }).format(parseDayKey("2030-03-20")),
    );
    // Typed text: a readable date moves the choice; unreadable text keeps it.
    await user.clear(screen.getByLabelText("Due date"));
    await user.type(screen.getByLabelText("Due date"), "Apr 2");
    expect(fields().dueDate).toBe("2030-04-02");
    expect(screen.getByRole("table")).toHaveAccessibleName(/April 2030/);
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

  it("moves through the grid from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness dueDate="2030-03-05" />);
    await user.click(screen.getByText(/^Due: /));
    const grid = within(screen.getByRole("table"));
    grid.getByRole("button", { name: day("2030-03-05") }).focus();
    await user.keyboard("{ArrowRight}{ArrowDown}");
    expect(grid.getByRole("button", { name: day("2030-03-13") })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(grid.getByRole("button", { name: day("2030-03-10") })).toHaveFocus();
    await user.keyboard("{End}{PageDown}");
    expect(grid.getByRole("button", { name: day("2030-04-16") })).toHaveFocus();
    expect(screen.getByRole("table")).toHaveAccessibleName(/April 2030/);
    await user.keyboard("{Enter}");
    expect(fields().dueDate).toBe("2030-04-16");
    await user.click(screen.getByRole("button", { name: "This month" }));
    expect(screen.getByRole("table")).toHaveAccessibleName(/March 2030/);
  });

  it("keeps the time off until asked for and clears it with the date", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText(/^Due: /));
    expect(screen.getByRole("button", { name: "Add time" })).toBeDisabled();
    expect(screen.getByText("Choose a date before a time.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /^Tomorrow/ }));
    expect(
      screen.getByText("Without a time, the task is due that whole day."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Add time" }));
    // A duration waits for a time.
    expect(screen.getByLabelText("Duration")).toBeDisabled();
    await user.type(screen.getByLabelText("Due time"), "21:00");
    expect(fields()).toEqual({
      dueDate: "2030-03-06",
      dueTime: "21:00",
      duration: "",
    });
    expect(screen.getByText(/^Due: /)).toHaveTextContent(
      /^Due: Tomorrow, 9:00 PM$/,
    );
    await user.selectOptions(screen.getByLabelText("Duration"), "90");
    expect(fields().duration).toBe("90");
    expect(screen.getByText(/^Due: /)).toHaveTextContent(
      /^Due: Tomorrow, 9:00 PM, 1 h 30 min$/,
    );
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
