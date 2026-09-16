// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CalendarRangePicker } from "../components/calendar-range";
import type { CalendarRange } from "../lib/calendar-range";
import { parseDayKey } from "../lib/day-placement";
import { dayName } from "./range-picker-support";

// 2030-03-05 is a Tuesday.
const now = parseDayKey("2030-03-05");
const monthName = (key: string) =>
  new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
    parseDayKey(`${key}-01`),
  );

function Harness({
  startDate = "",
  endDate = "",
}: {
  readonly startDate?: string;
  readonly endDate?: string;
}) {
  const [value, setValue] = useState<CalendarRange>({ startDate, endDate });
  return (
    <>
      <CalendarRangePicker now={now} onChange={setValue} value={value} />
      <output aria-label="Range">{JSON.stringify(value)}</output>
    </>
  );
}

const range = () =>
  JSON.parse(
    screen.getByRole("status", { name: "Range" }).textContent ?? "",
  ) as CalendarRange;
const day = (key: string) =>
  within(
    screen.getByRole("table", { name: monthName(key.slice(0, 7)) }),
  ).getByRole("button", { name: dayName(key) });
const shortcuts = () =>
  within(screen.getByRole("list", { name: "Schedule shortcuts" }));

afterEach(cleanup);

// The open list renders fifteen months of day buttons, which jsdom lays out
// slowly on a busy runner.
describe("CalendarRangePicker", { timeout: 15_000 }, () => {
  it("opens on today without dates and chooses a start, then an end, by clicks", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByText("Dates: not set")).toBeVisible();
    expect(screen.getByLabelText("Start date")).toHaveValue("");
    expect(day("2030-03-05")).toHaveClass("is-today");
    await user.click(day("2030-03-12"));
    expect(range()).toEqual({ startDate: "2030-03-12", endDate: "" });
    expect(screen.getByLabelText("Start date")).toHaveValue("Mar 12, 2030");
    expect(screen.getByText("Dates: Mar 12, 2030")).toBeVisible();
    await user.click(day("2030-03-15"));
    expect(range()).toEqual({ startDate: "2030-03-12", endDate: "2030-03-15" });
    expect(screen.getByLabelText("End date")).toHaveValue("Mar 15, 2030");
    expect(day("2030-03-12")).toHaveAttribute("aria-pressed", "true");
    expect(day("2030-03-15")).toHaveAttribute("aria-pressed", "true");
    expect(day("2030-03-13").closest("td")).toHaveClass("is-between");
    // A third click starts over; an earlier day than the start starts over too.
    await user.click(day("2030-03-20"));
    expect(range()).toEqual({ startDate: "2030-03-20", endDate: "" });
    await user.click(day("2030-03-18"));
    expect(range()).toEqual({ startDate: "2030-03-18", endDate: "" });
  });

  it("offers the schedule shortcuts, with the weekend spanning both days", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(
      shortcuts()
        .getAllByRole("button")
        .map((button) => button.querySelector("span")?.textContent),
    ).toEqual([
      "Today",
      "Tomorrow",
      "Later this week",
      "This weekend",
      "Next week",
      "No dates",
    ]);
    expect(
      shortcuts().getByRole("button", { name: "No dates" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(
      shortcuts().getByRole("button", { name: /^This weekend/ }),
    );
    expect(range()).toEqual({ startDate: "2030-03-09", endDate: "2030-03-10" });
    expect(
      shortcuts().getByRole("button", { name: /^This weekend/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      shortcuts().getByRole("button", { name: /^This weekend/ }),
    ).toHaveTextContent(/Sat to Sun$/);
    await user.click(shortcuts().getByRole("button", { name: /^Today/ }));
    expect(range()).toEqual({ startDate: "2030-03-05", endDate: "" });
    // Today alone, then a click on a later day ends there.
    await user.click(day("2030-03-07"));
    expect(range()).toEqual({ startDate: "2030-03-05", endDate: "2030-03-07" });
    await user.click(shortcuts().getByRole("button", { name: "No dates" }));
    expect(range()).toEqual({ startDate: "", endDate: "" });
    expect(screen.getByLabelText("Start date")).toHaveValue("");
    expect(screen.getByLabelText("End date")).toHaveValue("");
  });

  it("chooses a span by dragging across days, either way round", () => {
    render(<Harness />);
    const list = screen.getByRole("table", { name: monthName("2030-03") })
      .parentElement as HTMLElement;
    // jsdom has no layout; the pointer is wherever the test says it is.
    const over = (key: string) => {
      document.elementFromPoint = () => day(key);
    };
    fireEvent.pointerDown(day("2030-03-12"), {
      button: 0,
      pointerType: "mouse",
    });
    over("2030-03-14");
    fireEvent.pointerMove(list, { pointerType: "mouse" });
    expect(range()).toEqual({ startDate: "2030-03-12", endDate: "2030-03-14" });
    over("2030-03-09");
    fireEvent.pointerMove(list, { pointerType: "mouse" });
    expect(range()).toEqual({ startDate: "2030-03-09", endDate: "2030-03-12" });
    fireEvent.pointerUp(window);
    // The click that ends a drag changes nothing.
    fireEvent.click(day("2030-03-09"));
    expect(range()).toEqual({ startDate: "2030-03-09", endDate: "2030-03-12" });
    // A press released on the same day is a click.
    fireEvent.pointerDown(day("2030-03-20"), {
      button: 0,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(window);
    fireEvent.click(day("2030-03-20"));
    expect(range()).toEqual({ startDate: "2030-03-20", endDate: "" });
  });

  it("reads typed dates and keeps an existing range behind a closed summary", async () => {
    const user = userEvent.setup();
    render(<Harness startDate="2030-07-03" endDate="2030-07-12" />);
    expect(
      screen.getByText("Dates: Jul 3, 2030 to Jul 12, 2030"),
    ).toBeVisible();
    expect(screen.queryByLabelText("Start date")).toBeNull();
    await user.click(screen.getByText(/^Dates: /));
    expect(screen.getByLabelText("Start date")).toHaveValue("Jul 3, 2030");
    expect(screen.getByLabelText("End date")).toHaveValue("Jul 12, 2030");
    expect(
      screen.getByRole("button", {
        name: `Choose a month and year, showing ${monthName("2030-07")}`,
      }),
    ).toBeVisible();
    // A start after the end clears the end.
    await user.clear(screen.getByLabelText("Start date"));
    await user.paste("Jul 20, 2030");
    expect(range()).toEqual({ startDate: "2030-07-20", endDate: "" });
    expect(screen.getByLabelText("End date")).toHaveValue("");
    // An end alone, with no start, waits for a start.
    await user.clear(screen.getByLabelText("Start date"));
    await user.click(screen.getByLabelText("End date"));
    await user.paste("Jul 22, 2030");
    expect(range()).toEqual({ startDate: "", endDate: "" });
    expect(screen.getByText("Choose a start date first.")).toBeVisible();
    await user.click(screen.getByLabelText("Start date"));
    await user.paste("tomorrow");
    expect(range()).toEqual({ startDate: "2030-03-06", endDate: "2030-07-22" });
  });

  it("moves through the months from the keyboard and chooses with Enter", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    day("2030-03-05").focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{Enter}");
    expect(range()).toEqual({ startDate: "2030-03-07", endDate: "" });
    await user.keyboard("{ArrowDown}{Enter}");
    expect(range()).toEqual({ startDate: "2030-03-07", endDate: "2030-03-14" });
    await user.keyboard("{PageDown}");
    expect(day("2030-04-14")).toHaveFocus();
  });
});
