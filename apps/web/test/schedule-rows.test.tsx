// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Providers } from "../app/providers";
import { ScheduleRows, scheduleChange } from "../features/events/schedule-rows";
import type { EventScheduleDraft } from "../lib/event-schedule";
import { formatTime, fromDateTimeInput } from "../lib/format";
import { dateRow, setDates, setRowDate, setTimes } from "./date-rows";

const now = new Date("2030-10-20T12:00:00");

function Harness({ withPlace = true }: { withPlace?: boolean }) {
  const [value, setValue] = useState<EventScheduleDraft>({
    mode: "unscheduled",
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
  });
  const [place, setPlace] = useState("");
  return (
    <>
      <output data-testid="value">{JSON.stringify({ ...value, place })}</output>
      <ScheduleRows
        now={now}
        onChange={(change) =>
          setValue((current) => ({ ...current, ...change }))
        }
        value={value}
        {...(withPlace && { place: { value: place, onChange: setPlace } })}
      />
    </>
  );
}

const held = () => JSON.parse(screen.getByTestId("value").textContent ?? "");
const clock = (day: string, time: string) =>
  formatTime(fromDateTimeInput(`${day}T${time}`) ?? "");

afterEach(cleanup);

describe("scheduleChange", () => {
  it("derives the mode from what is set", () => {
    const empty = { startDate: "", endDate: "", startTime: "", endTime: "" };
    expect(scheduleChange(empty).mode).toBe("unscheduled");
    expect(scheduleChange({ ...empty, startDate: "2030-11-03" }).mode).toBe(
      "dates",
    );
    expect(
      scheduleChange({ ...empty, startDate: "2030-11-03", startTime: "09:00" })
        .mode,
    ).toBe("timed");
    // An end time cannot stand without a start time.
    expect(
      scheduleChange({ ...empty, startDate: "2030-11-03", endTime: "11:00" }),
    ).toMatchObject({ mode: "dates", endTime: "" });
  });
});

describe("the schedule rows", () => {
  it("read what is unset with a hint, and what is set with a clear", async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper: Providers });
    expect(dateRow(/^Set dates/)).toHaveTextContent("A day, or a span of days");
    expect(dateRow(/^Set times/)).toHaveTextContent("All day");
    expect(screen.queryByRole("button", { name: "Clear dates" })).toBeNull();

    await setDates(user, "2030-11-03", "2030-11-05");
    expect(held()).toMatchObject({
      mode: "dates",
      startDate: "2030-11-03",
      endDate: "2030-11-05",
    });
    expect(dateRow(/^Dates/)).toHaveTextContent(
      "Dates: Nov 3, 2030 to Nov 5, 2030",
    );
    await user.click(screen.getByRole("button", { name: "Clear dates" }));
    expect(held()).toMatchObject({ mode: "unscheduled", startDate: "" });
    expect(dateRow(/^Set dates/)).toBeVisible();
  });

  it("opens the times row on the panel with the times unfolded, and clears them alone", async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper: Providers });
    await setDates(user, "2030-11-03");
    await setTimes(user, "09:00", "11:00");
    expect(held()).toMatchObject({
      mode: "timed",
      startDate: "2030-11-03",
      endDate: "2030-11-03",
      startTime: "09:00",
      endTime: "11:00",
    });
    expect(dateRow(/^Times/)).toHaveTextContent(
      `Times: ${clock("2030-11-03", "09:00")} to ${clock("2030-11-03", "11:00")}`,
    );
    await user.click(screen.getByRole("button", { name: "Clear times" }));
    expect(held()).toMatchObject({
      mode: "dates",
      startDate: "2030-11-03",
      startTime: "",
      endTime: "",
    });
    expect(dateRow(/^Set times/)).toBeVisible();
  });

  it("sets the dates from the times row when none are set yet", async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper: Providers });
    await user.click(dateRow(/^Set times/));
    expect(screen.getByLabelText("Start")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type a date"), {
      target: { value: "tomorrow" },
    });
    fireEvent.change(screen.getByLabelText("Start"), {
      target: { value: "18:00" },
    });
    expect(held()).toMatchObject({
      mode: "timed",
      startDate: "2030-10-21",
      startTime: "18:00",
    });
  });

  it("returns focus to the row that opened the panel on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper: Providers });
    await user.click(dateRow(/^Set dates/));
    expect(dateRow(/^Set dates/)).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(screen.getByLabelText("Type a date"), { key: "Escape" });
    expect(screen.queryByLabelText("Type a date")).toBeNull();
    expect(dateRow(/^Set dates/)).toHaveFocus();
    expect(dateRow(/^Set dates/)).toHaveAttribute("aria-expanded", "false");
  });

  it("edits the place in place and reads it back on its row", async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: /^Add a place/ }));
    const place = screen.getByLabelText("Place");
    expect(place).toHaveFocus();
    await user.type(place, "The garden{Enter}");
    expect(held()).toMatchObject({ place: "The garden" });
    const row = screen.getByRole("button", { name: /^Place/ });
    expect(row).toHaveTextContent("The garden");
    expect(row).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Clear place" }));
    expect(held()).toMatchObject({ place: "" });
    expect(screen.getByRole("button", { name: /^Add a place/ })).toBeVisible();
  });

  it("leaves the place row out for an editor without one", () => {
    render(<Harness withPlace={false} />, { wrapper: Providers });
    expect(screen.queryByRole("button", { name: /^Add a place/ })).toBeNull();
  });

  it("applies a typed day and time in one visit", async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper: Providers });
    await setRowDate(user, /^Set dates/, "Nov 3");
    expect(held()).toMatchObject({ mode: "dates", startDate: "2030-11-03" });
  });
});
