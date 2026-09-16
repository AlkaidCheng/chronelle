// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MonthGrid,
  PeriodNav,
  periodLabel,
  shiftPeriod,
  WeekStrip,
} from "../components/period-views";
import { dayKeyOf, parseDayKey } from "../lib/day-placement";

const at = (key: string) => parseDayKey(key);
const fullDay = (key: string) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(at(key));

afterEach(cleanup);

describe("period views", () => {
  it("labels a week by its span and a month by its name", () => {
    const short = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    });
    expect(periodLabel("week", at("2030-03-06"))).toBe(
      `${short.format(at("2030-03-04"))} - ${short.format(at("2030-03-10"))}, 2030`,
    );
    const thisYear = new Date();
    expect(periodLabel("week", thisYear)).not.toMatch(/, \d{4}$/);
    expect(periodLabel("month", at("2030-03-06"))).toBe(
      new Intl.DateTimeFormat(undefined, {
        month: "long",
        year: "numeric",
      }).format(at("2030-03-01")),
    );
  });

  it("moves by whole weeks and whole months across year ends", () => {
    expect(dayKeyOf(shiftPeriod("week", at("2030-03-06"), 1))).toBe(
      "2030-03-13",
    );
    expect(dayKeyOf(shiftPeriod("week", at("2030-01-02"), -1))).toBe(
      "2029-12-26",
    );
    expect(dayKeyOf(shiftPeriod("month", at("2030-12-31"), 1))).toBe(
      "2031-01-01",
    );
    expect(dayKeyOf(shiftPeriod("month", at("2030-01-15"), -1))).toBe(
      "2029-12-01",
    );
    // The end of a long month lands on the first of the next, never overflowing.
    expect(dayKeyOf(shiftPeriod("month", at("2030-03-31"), 1))).toBe(
      "2030-04-01",
    );
  });

  it("navigates a period and returns to today", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(cursor: Date) => void>();
    render(
      <PeriodNav cursor={at("2030-03-06")} onChange={onChange} period="week" />,
    );
    const nav = within(screen.getByRole("group", { name: "Period" }));
    await user.click(nav.getByRole("button", { name: "Next week" }));
    expect(dayKeyOf(onChange.mock.calls[0]?.[0] as Date)).toBe("2030-03-13");
    await user.click(nav.getByRole("button", { name: "Previous week" }));
    expect(dayKeyOf(onChange.mock.calls[1]?.[0] as Date)).toBe("2030-02-27");
    await user.click(nav.getByRole("button", { name: "Today" }));
    expect(dayKeyOf(onChange.mock.calls[2]?.[0] as Date)).toBe(
      dayKeyOf(new Date()),
    );
  });

  it("lays a week out Monday first with today marked", () => {
    render(
      <WeekStrip
        cursor={at("2030-03-06")}
        renderDay={(day) => <span>{day}</span>}
        today={at("2030-03-08")}
      />,
    );
    const days = screen.getAllByRole("listitem");
    expect(days.map((day) => day.getAttribute("aria-label"))).toEqual(
      [
        "2030-03-04",
        "2030-03-05",
        "2030-03-06",
        "2030-03-07",
        "2030-03-08",
        "2030-03-09",
        "2030-03-10",
      ].map(fullDay),
    );
    expect(days[4]).toHaveClass("is-today");
    expect(days[3]).not.toHaveClass("is-today");
    expect(
      within(days[0] as HTMLElement).getByText("2030-03-04"),
    ).toBeVisible();
  });

  it("shows six weeks of a month, counts what a cell cannot show, and selects a day", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn<(day: string) => void>();
    const items: Record<string, string[]> = {
      "2030-03-06": ["Book flights", "Pack", "Call the hotel", "Buy adapters"],
      "2030-03-08": ["Depart"],
    };
    render(
      <MonthGrid
        cursor={at("2030-03-06")}
        onSelect={onSelect}
        renderItem={(day) =>
          (items[day] ?? []).map((name) => ({ key: name, node: name }))
        }
        selected="2030-03-08"
        today={at("2030-03-07")}
      />,
    );
    const grid = screen.getByRole("table", { name: /2030/ });
    const cells = within(grid).getAllByRole("cell");
    expect(cells).toHaveLength(42);
    expect(cells[0]).toHaveClass("is-outside");
    expect(cells[4]).not.toHaveClass("is-outside");
    expect(cells.at(-1)).toHaveClass("is-outside");
    const day = (key: string) =>
      within(grid).getByRole("button", {
        name: new RegExp(`^${fullDay(key)}`),
      });
    expect(day("2030-03-06")).toHaveAccessibleName(
      `${fullDay("2030-03-06")}, 4 items`,
    );
    expect(within(day("2030-03-06")).getByText("+1 more")).toBeVisible();
    expect(within(day("2030-03-06")).queryByText("Buy adapters")).toBeNull();
    expect(day("2030-03-08")).toHaveAccessibleName(
      `${fullDay("2030-03-08")}, 1 item`,
    );
    expect(day("2030-03-08")).toHaveAttribute("aria-pressed", "true");
    expect(day("2030-03-08").closest("td")).toHaveClass(
      "is-selected",
      "has-items",
    );
    expect(day("2030-03-07").closest("td")).not.toHaveClass("has-items");
    expect(day("2030-03-07").closest("td")).toHaveClass("is-today");
    expect(day("2030-03-07")).toHaveAttribute("aria-pressed", "false");
    await user.click(day("2030-03-06"));
    expect(onSelect).toHaveBeenCalledWith("2030-03-06");
  });
});
