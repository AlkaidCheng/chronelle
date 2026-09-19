// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Providers } from "../app/providers";
import { type DueFields, DueRow, describeDue } from "../components/due-row";
import { formatTime, fromDateTimeInput } from "../lib/format";
import { dateRow, openDatePanel, setRowDate } from "./date-rows";

const now = new Date("2030-10-20T12:00:00");

function Harness(initial: Partial<DueFields>) {
  const [due, setDue] = useState<DueFields>({
    dueDate: "",
    dueTime: "",
    repeat: "",
    repeatUntil: "",
    ...initial,
  });
  return (
    <>
      <output data-testid="value">{JSON.stringify(due)}</output>
      <DueRow now={now} onChange={setDue} {...due} />
    </>
  );
}

const held = () => JSON.parse(screen.getByTestId("value").textContent ?? "");
const clock = (day: string, time: string) =>
  formatTime(fromDateTimeInput(`${day}T${time}`) ?? "");

afterEach(cleanup);

describe("describeDue", () => {
  it("reads the day with today or tomorrow as a hint, then the time, then the rule", () => {
    expect(describeDue("", "", now)).toBe("No date");
    expect(describeDue("2030-10-20", "", now)).toBe("Oct 20, 2030 (today)");
    expect(describeDue("2030-10-21", "09:30", now)).toBe(
      `Oct 21, 2030 (tomorrow), ${clock("2030-10-21", "09:30")}`,
    );
    expect(describeDue("2030-11-03", "", now, "weekly", "2030-12-01")).toBe(
      "Nov 3, 2030, every week until Dec 1, 2030",
    );
  });
});

describe("the due row", () => {
  it("reads Set due date with its hint, then the due, with a clear", async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper: Providers });
    expect(dateRow(/^Set due date/)).toHaveTextContent(
      "A day, a time, and a rule",
    );
    expect(screen.queryByRole("button", { name: "Clear due date" })).toBeNull();
    await setRowDate(user, /^Set due date/, "Nov 3", "14:00");
    expect(held()).toMatchObject({ dueDate: "2030-11-03", dueTime: "14:00" });
    expect(dateRow(/^Due date/)).toHaveTextContent(
      `Due date: Nov 3, 2030, ${clock("2030-11-03", "14:00")}`,
    );
    await user.click(screen.getByRole("button", { name: "Clear due date" }));
    expect(held()).toEqual({
      dueDate: "",
      dueTime: "",
      repeat: "",
      repeatUntil: "",
    });
  });

  it("opens the panel with Repeat, and drops the rule with the date", async () => {
    const user = userEvent.setup();
    render(<Harness dueDate="2030-11-03" />, { wrapper: Providers });
    await openDatePanel(user, /^Due date/);
    await user.click(screen.getByRole("button", { name: "Repeat" }));
    await user.selectOptions(screen.getByLabelText("Repeat"), "monthly");
    fireEvent.change(screen.getByLabelText("Until"), {
      target: { value: "2031-03-01" },
    });
    expect(held()).toMatchObject({
      repeat: "monthly",
      repeatUntil: "2031-03-01",
    });
    expect(dateRow(/^Due date/)).toHaveTextContent(
      "every month until Mar 1, 2031",
    );
    // A later due date keeps the rule; a due date after the end drops the end.
    fireEvent.change(screen.getByLabelText("Type a date"), {
      target: { value: "2031-04-01" },
    });
    expect(held()).toMatchObject({
      dueDate: "2031-04-01",
      repeat: "monthly",
      repeatUntil: "",
    });
    fireEvent.change(screen.getByLabelText("Type a date"), {
      target: { value: "" },
    });
    expect(held()).toMatchObject({ dueDate: "", repeat: "" });
  });

  it("returns focus to the row on Escape and keeps it on a press outside", async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper: Providers });
    const row = dateRow(/^Set due date/);
    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(screen.getByLabelText("Type a date"), { key: "Escape" });
    expect(screen.queryByLabelText("Type a date")).toBeNull();
    expect(row).toHaveFocus();
    await user.click(row);
    fireEvent.pointerDown(screen.getByTestId("value"));
    expect(screen.queryByLabelText("Type a date")).toBeNull();
    expect(row).toHaveAttribute("aria-expanded", "false");
  });
});
