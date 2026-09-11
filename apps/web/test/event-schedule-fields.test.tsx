// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventScheduleFields } from "../features/events/event-schedule-fields";
import {
  type EventScheduleDraft,
  eventSchedulePayload,
  readEventSchedule,
} from "../lib/event-schedule";

const onSubmit = vi.fn();
const range: EventScheduleDraft = {
  ...readEventSchedule(),
  mode: "dates",
  startDate: "2030-07-03",
  endDate: "2030-07-12",
};

function Harness({
  initial = range,
  disabled = false,
}: {
  initial?: EventScheduleDraft;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <EventScheduleFields
        value={value}
        disabled={disabled}
        onChange={(change) =>
          setValue((current) => ({ ...current, ...change }))
        }
      />
      <button type="submit">Save</button>
    </form>
  );
}

beforeEach(() => {
  onSubmit.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("event schedule controls", () => {
  it("requires explicit times and retains them when times are toggled", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("switch", { name: "Add times" }));
    const start = screen.getByLabelText<HTMLInputElement>("Start time");
    const end = screen.getByLabelText<HTMLInputElement>("End time");
    expect(start.value).toBe("");
    expect(end.value).toBe("");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(start, { target: { value: "10:30" } });
    fireEvent.change(end, { target: { value: "18:15" } });
    await user.click(screen.getByRole("switch", { name: "Add times" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(eventSchedulePayload(onSubmit.mock.lastCall?.[0])).toEqual({
      startsOn: range.startDate,
      endsOn: range.endDate,
      startsAt: null,
      endsAt: null,
    });
    await user.click(screen.getByRole("switch", { name: "Add times" }));
    expect(screen.getByLabelText<HTMLInputElement>("Start time").value).toBe(
      "10:30",
    );
    expect(screen.getByLabelText<HTMLInputElement>("End time").value).toBe(
      "18:15",
    );
  });

  it("clears only the end date and time, restoring focus to the end control", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          ...range,
          mode: "timed",
          startTime: "10:30",
          endTime: "18:15",
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Clear end date" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "End date: Optional" }),
    );
    expect(screen.getByLabelText<HTMLInputElement>("Start time").value).toBe(
      "10:30",
    );
    expect(
      screen.getByLabelText<HTMLInputElement>("End time (optional)").value,
    ).toBe("");
    expect(
      screen.getByRole("status", { name: "Date range summary" }).textContent,
    ).toBe("End date optional.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(eventSchedulePayload(onSubmit.mock.lastCall?.[0])).toEqual({
      startsAt: new Date("2030-07-03T10:30").toISOString(),
      endsAt: null,
      startsOn: null,
      endsOn: null,
    });
    await user.click(
      screen.getByRole("button", { name: "End date: Optional" }),
    );
    await user.click(screen.getByRole("button", { name: "Jul 12, 2030" }));
    expect(screen.getByLabelText<HTMLInputElement>("End time").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("End time").required).toBe(
      true,
    );
  });

  it("keeps selected dates when scheduling is temporarily disabled", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("switch", { name: "Set dates" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(eventSchedulePayload(onSubmit.mock.lastCall?.[0])).toEqual({
      startsAt: null,
      endsAt: null,
      startsOn: null,
      endsOn: null,
    });
    await user.click(screen.getByRole("switch", { name: "Set dates" }));
    expect(
      screen.getByRole("status", { name: "Date range summary" }).textContent,
    ).toBe("10 days, including start and end dates.");
  });

  it.each(["1", "99", "2099", "9999"])(
    "jumps directly to year %s without changing or submitting the schedule",
    async (year) => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(
        screen.getByRole("button", { name: "Start date: Jul 3, 2030" }),
      );
      await user.click(screen.getByRole("button", { name: "Change year" }));
      const input = screen.getByLabelText("Go to year");
      await user.clear(input);
      await user.type(input, `${year}{Enter}`);
      expect(onSubmit).not.toHaveBeenCalled();
      expect(document.activeElement?.getAttribute("data-date")).toBe(
        `${year.padStart(4, "0")}-07-01`,
      );
      expect(
        screen.getByRole("button", { name: "Start date: Jul 3, 2030" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "End date: Jul 12, 2030" }),
      ).toBeTruthy();
    },
  );

  it.each(["", "0", "-1", "1e3", "abcd"])(
    "keeps invalid year input %s out of the calendar and event payload",
    async (year) => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(
        screen.getByRole("button", { name: "Start date: Jul 3, 2030" }),
      );
      await user.click(screen.getByRole("button", { name: "Change year" }));
      const input = screen.getByLabelText("Go to year");
      await user.clear(input);
      if (year) await user.type(input, year);
      await user.keyboard("{Enter}");
      expect(onSubmit).not.toHaveBeenCalled();
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: "Go",
        }).disabled,
      ).toBe(true);
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(eventSchedulePayload(onSubmit.mock.lastCall?.[0]).startsOn).toBe(
        range.startDate,
      );
    },
  );

  it("locks all schedule controls during a pending save", async () => {
    const user = userEvent.setup();
    render(<Harness disabled />);
    await user.click(screen.getByRole("button", { name: "Clear end date" }));
    await user.click(screen.getByRole("switch", { name: "Add times" }));
    expect(
      screen.getByRole("button", { name: "End date: Jul 12, 2030" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Start time")).toBeNull();
  });

  it("clears hidden end times when removing a date-only end", async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={{ ...range, startTime: "10:30", endTime: "18:15" }} />,
    );
    await user.click(screen.getByRole("button", { name: "Clear end date" }));
    await user.click(screen.getByRole("switch", { name: "Add times" }));
    expect(screen.getByLabelText<HTMLInputElement>("Start time").value).toBe(
      "10:30",
    );
    expect(
      screen.getByLabelText<HTMLInputElement>("End time (optional)").value,
    ).toBe("");
  });
});
