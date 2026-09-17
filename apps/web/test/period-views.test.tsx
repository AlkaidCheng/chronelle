// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MonthGrid,
  PeriodNav,
  periodLabel,
  shiftPeriod,
  WeekStrip,
} from "../components/period-views";
import { dayKeyOf, parseDayKey } from "../lib/day-placement";
import { DisplayPreferencesProvider } from "../lib/use-display-preferences";

const at = (key: string) => parseDayKey(key);
const mondayFirst = ({ children }: { readonly children: ReactNode }) => (
  <DisplayPreferencesProvider
    preferences={{ timeZone: null, hourCycle: null, weekStart: 1 }}
  >
    {children}
  </DisplayPreferencesProvider>
);
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
    // English weeks start on Sunday unless the account chose Monday.
    expect(periodLabel("week", at("2030-03-06"))).toBe(
      `${short.format(at("2030-03-03"))} - ${short.format(at("2030-03-09"))}, 2030`,
    );
    expect(periodLabel("week", at("2030-03-06"), "en", 1)).toBe(
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

  it("steps a period with three icon buttons and returns to this one", async () => {
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
    await user.click(nav.getByRole("button", { name: "This week" }));
    expect(dayKeyOf(onChange.mock.calls[2]?.[0] as Date)).toBe(
      dayKeyOf(new Date()),
    );
    expect(nav.getByRole("button", { name: "This week" })).toHaveAttribute(
      "title",
      "This week",
    );
  });

  it("titles a month with its name in bold and the year after it", () => {
    render(
      <PeriodNav cursor={at("2030-03-06")} onChange={vi.fn()} period="month" />,
    );
    const title = screen.getByRole("group", { name: "Period" });
    expect(within(title).getByText("March").tagName).toBe("STRONG");
    expect(title).toHaveTextContent(/March 2030/);
    expect(screen.getByRole("button", { name: "This month" })).toBeVisible();
  });

  it("lays a week out from the account's first day with today marked", () => {
    const { unmount } = render(
      <WeekStrip
        cursor={at("2030-03-06")}
        renderDay={(day) => <span>{day}</span>}
        today={at("2030-03-08")}
      />,
    );
    // English weeks start on Sunday unless the account chose Monday.
    expect(
      screen
        .getAllByRole("listitem")
        .map((day) => day.getAttribute("aria-label")),
    ).toEqual(
      [
        "2030-03-03",
        "2030-03-04",
        "2030-03-05",
        "2030-03-06",
        "2030-03-07",
        "2030-03-08",
        "2030-03-09",
      ].map(fullDay),
    );
    unmount();
    render(
      <WeekStrip
        cursor={at("2030-03-06")}
        renderDay={(day) => <span>{day}</span>}
        today={at("2030-03-08")}
      />,
      { wrapper: mondayFirst },
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
    expect(days[4]).toHaveTextContent("Today");
    expect(days[3]).not.toHaveClass("is-today");
    expect(days[3]).not.toHaveTextContent("Today");
    expect(
      within(days[0] as HTMLElement).getByText("2030-03-04"),
    ).toBeVisible();
  });

  it("stops the month after the week holding its last day and names the first of a month", async () => {
    const user = userEvent.setup();
    const items: Record<string, string[]> = {
      "2030-03-06": ["Book flights", "Pack", "Call the hotel", "Buy adapters"],
      "2030-03-08": ["Depart"],
    };
    const renderDay = vi.fn((day: string, limit: number | null) => (
      <ul>
        {(items[day] ?? []).slice(0, limit ?? undefined).map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    ));
    render(
      <MonthGrid
        countOf={(day) => (items[day] ?? []).length}
        cursor={at("2030-03-06")}
        renderDay={renderDay}
        today={at("2030-03-07")}
      />,
      { wrapper: mondayFirst },
    );
    const grid = screen.getByRole("table", { name: /2030/ });
    // March 2030 starts on a Friday and ends on a Sunday: five Monday-first
    // weeks, no week of April alone.
    const cells = within(grid).getAllByRole("cell");
    expect(cells).toHaveLength(35);
    expect(cells[0]).toHaveClass("is-outside");
    expect(cells[0]).toHaveAccessibleName(fullDay("2030-02-25"));
    expect(cells[4]).not.toHaveClass("is-outside");
    expect(cells[4]).toHaveTextContent(/^Mar 1$/);
    expect(cells.at(-1)).toHaveAccessibleName(fullDay("2030-03-31"));
    expect(cells.at(-1)).not.toHaveClass("is-outside");
    expect(
      within(grid)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(
      [
        "2030-03-04",
        "2030-03-05",
        "2030-03-06",
        "2030-03-07",
        "2030-03-08",
        "2030-03-09",
        "2030-03-10",
      ].map((day) =>
        new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(
          at(day),
        ),
      ),
    );
    const day = (key: string) =>
      within(grid).getByRole("cell", {
        name: new RegExp(`^${fullDay(key)}`),
      });
    expect(day("2030-03-06")).toHaveAccessibleName(
      `${fullDay("2030-03-06")}, 4 items`,
    );
    expect(day("2030-03-06")).toHaveClass("has-items");
    expect(day("2030-03-07")).toHaveClass("is-today");
    expect(day("2030-03-07")).not.toHaveClass("has-items");
    expect(day("2030-03-08")).toHaveAccessibleName(
      `${fullDay("2030-03-08")}, 1 item`,
    );
    // Three rows show; the rest fold behind "+N more", which opens the day.
    expect(renderDay).toHaveBeenCalledWith("2030-03-06", 3);
    expect(within(day("2030-03-06")).queryByText("Buy adapters")).toBeNull();
    await user.click(
      within(day("2030-03-06")).getByRole("button", { name: "+1 more" }),
    );
    expect(within(day("2030-03-06")).getByText("Buy adapters")).toBeVisible();
    expect(
      within(day("2030-03-06")).queryByRole("button", { name: /more/ }),
    ).toBeNull();
    expect(renderDay).toHaveBeenCalledWith("2030-03-06", null);
    // An empty day renders no rows at all.
    expect(renderDay).not.toHaveBeenCalledWith("2030-03-07", 3);
  });
});
