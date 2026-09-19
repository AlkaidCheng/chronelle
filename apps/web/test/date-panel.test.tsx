// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import {
  DatePanel,
  type DayValue,
  type RepeatValue,
  type SpanValue,
} from "../components/date-panel";
import { dayName } from "./date-rows";

// A Sunday, so the coming Monday and Saturday are both inside the week.
const now = new Date("2030-10-20T12:00:00");
const onClose = vi.fn<(byKeyboard: boolean) => void>();

function DayHarness({
  repeat: withRepeat = false,
  time = "",
}: {
  repeat?: boolean;
  time?: string;
}) {
  const [value, setValue] = useState<DayValue>({ day: "", time });
  const [repeat, setRepeat] = useState<RepeatValue>({ rule: "", until: "" });
  return (
    <>
      <output data-testid="value">
        {JSON.stringify({ ...value, ...repeat })}
      </output>
      <div>
        <DatePanel
          kind="day"
          label="Due date"
          now={now}
          onChange={setValue}
          onClose={onClose}
          value={value}
          {...(withRepeat && { repeat, onRepeatChange: setRepeat })}
        />
      </div>
    </>
  );
}

function SpanHarness() {
  const [value, setValue] = useState<SpanValue>({
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
  });
  return (
    <>
      <output data-testid="value">{JSON.stringify(value)}</output>
      <div>
        <DatePanel
          kind="span"
          label="Dates"
          now={now}
          onChange={setValue}
          onClose={onClose}
          value={value}
        />
      </div>
    </>
  );
}

const held = () => JSON.parse(screen.getByTestId("value").textContent ?? "");
const typed = () => screen.getByLabelText("Type a date");

afterEach(() => {
  cleanup();
  onClose.mockClear();
});

describe("the date panel", () => {
  it("reads a typed date, applies it with Enter, and refuses what it cannot read", () => {
    render(<DayHarness />, { wrapper: Providers });
    expect(typed()).toHaveFocus();
    fireEvent.change(typed(), { target: { value: "Nov 3" } });
    expect(held()).toMatchObject({ day: "2030-11-03" });
    expect(typed()).not.toHaveAttribute("aria-invalid", "true");
    fireEvent.keyDown(typed(), { key: "Enter" });
    expect(onClose).toHaveBeenCalledWith(true);

    onClose.mockClear();
    fireEvent.change(typed(), { target: { value: "someday" } });
    expect(typed()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/^Not a date the panel knows/)).toBeVisible();
    expect(held()).toMatchObject({ day: "2030-11-03" });
    fireEvent.keyDown(typed(), { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.change(typed(), { target: { value: "" } });
    expect(held()).toMatchObject({ day: "" });
  });

  it("offers the four shortcuts with their days and presses the one that holds", async () => {
    const user = userEvent.setup();
    render(<DayHarness />, { wrapper: Providers });
    const shortcuts = screen.getByRole("list", { name: "Shortcuts" });
    expect(shortcuts).toHaveTextContent("Today");
    expect(shortcuts).toHaveTextContent("Tomorrow");
    expect(shortcuts).toHaveTextContent(/Next week\s*Mon Oct 21/);
    expect(shortcuts).toHaveTextContent(/Next weekend\s*Sat Oct 26/);
    await user.click(screen.getByRole("button", { name: /^Tomorrow/ }));
    expect(held()).toMatchObject({ day: "2030-10-21" });
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("keeps a day's time when its day changes and drops it with the day", () => {
    render(<DayHarness time="09:30" />, { wrapper: Providers });
    fireEvent.change(typed(), { target: { value: "2030-11-03" } });
    expect(held()).toMatchObject({ day: "2030-11-03", time: "09:30" });
    fireEvent.change(typed(), { target: { value: "" } });
    expect(held()).toMatchObject({ day: "", time: "" });
  });

  it("sets a single date from the months and closes", async () => {
    const user = userEvent.setup();
    render(<DayHarness />, { wrapper: Providers });
    await user.click(
      screen.getByRole("button", { name: dayName("2030-10-23") }),
    );
    expect(held()).toMatchObject({ day: "2030-10-23" });
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("selects a span as a start then an end and stays open", async () => {
    const user = userEvent.setup();
    render(<SpanHarness />, { wrapper: Providers });
    await user.click(
      screen.getByRole("button", { name: dayName("2030-10-23") }),
    );
    expect(held()).toMatchObject({ startDate: "2030-10-23", endDate: "" });
    expect(onClose).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: dayName("2030-10-25") }),
    );
    expect(held()).toMatchObject({
      startDate: "2030-10-23",
      endDate: "2030-10-25",
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(typed()).toHaveValue("Oct 23, 2030 to Oct 25, 2030");
  });

  it("reads a typed span and refuses an end before its start", () => {
    render(<SpanHarness />, { wrapper: Providers });
    fireEvent.change(typed(), { target: { value: "Nov 3 to Nov 5" } });
    expect(held()).toMatchObject({
      startDate: "2030-11-03",
      endDate: "2030-11-05",
    });
    fireEvent.change(typed(), { target: { value: "Nov 5 to Nov 3" } });
    expect(
      screen.getByText("The end cannot come before the start."),
    ).toBeVisible();
    expect(held()).toMatchObject({
      startDate: "2030-11-03",
      endDate: "2030-11-05",
    });
    fireEvent.keyDown(typed(), { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("presses the weekend shortcut as a span through Sunday", async () => {
    const user = userEvent.setup();
    render(<SpanHarness />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: /^Next weekend/ }));
    expect(held()).toMatchObject({
      startDate: "2030-10-26",
      endDate: "2030-10-27",
    });
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("unfolds Time once a day is set, and folds it back with Remove time", async () => {
    const user = userEvent.setup();
    render(<DayHarness />, { wrapper: Providers });
    const time = screen.getByRole("button", { name: "Time" });
    expect(time).toBeDisabled();
    fireEvent.change(typed(), { target: { value: "tomorrow" } });
    await user.click(time);
    expect(screen.queryByRole("button", { name: "Time" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: "14:15" },
    });
    expect(held()).toMatchObject({ day: "2030-10-21", time: "14:15" });
    await user.click(screen.getByRole("button", { name: "Remove time" }));
    expect(held()).toMatchObject({ day: "2030-10-21", time: "" });
    expect(screen.getByRole("button", { name: "Time" })).toBeEnabled();
  });

  it("unfolds Start and End for a span, an end time closing the span on its day", async () => {
    const user = userEvent.setup();
    render(<SpanHarness />, { wrapper: Providers });
    fireEvent.change(typed(), { target: { value: "2030-11-03" } });
    await user.click(screen.getByRole("button", { name: "Times" }));
    fireEvent.change(screen.getByLabelText("Start"), {
      target: { value: "09:00" },
    });
    fireEvent.change(screen.getByLabelText("End"), {
      target: { value: "11:00" },
    });
    expect(held()).toEqual({
      startDate: "2030-11-03",
      endDate: "2030-11-03",
      startTime: "09:00",
      endTime: "11:00",
    });
    await user.click(screen.getByRole("button", { name: "Remove times" }));
    expect(held()).toMatchObject({ startTime: "", endTime: "" });
  });

  it("unfolds Repeat when offered, asking for an end only with a rule", async () => {
    const user = userEvent.setup();
    render(<DayHarness repeat />, { wrapper: Providers });
    const repeat = screen.getByRole("button", { name: "Repeat" });
    expect(repeat).toBeDisabled();
    fireEvent.change(typed(), { target: { value: "2030-11-03" } });
    await user.click(repeat);
    expect(screen.queryByLabelText("Until")).toBeNull();
    await user.selectOptions(screen.getByLabelText("Repeat"), "weekly");
    expect(held()).toMatchObject({ rule: "weekly", until: "" });
    fireEvent.change(screen.getByLabelText("Until"), {
      target: { value: "Nov 1" },
    });
    expect(
      screen.getByText("The end cannot come before the due date."),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Until"), {
      target: { value: "Dec 1" },
    });
    expect(held()).toMatchObject({ rule: "weekly", until: "2030-12-01" });
    await user.selectOptions(screen.getByLabelText("Repeat"), "");
    expect(held()).toMatchObject({ rule: "", until: "" });
  });

  it("closes on Escape as a keyboard close and on a press outside", () => {
    render(<DayHarness />, { wrapper: Providers });
    fireEvent.keyDown(typed(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledWith(true);
    onClose.mockClear();
    fireEvent.pointerDown(screen.getByTestId("value"));
    expect(onClose).toHaveBeenCalledWith(false);
  });
});
