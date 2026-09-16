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

  it("clears the end and its time from the End date field, then takes a new end", async () => {
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
    await user.click(screen.getByText("Dates: Jul 3, 2030 to Jul 12, 2030"));
    await user.clear(screen.getByLabelText("End date"));
    expect(screen.getByText("Dates: Jul 3, 2030")).toBeVisible();
    expect(screen.getByLabelText<HTMLInputElement>("Start time").value).toBe(
      "10:30",
    );
    expect(
      screen.getByLabelText<HTMLInputElement>("End time (optional)").value,
    ).toBe("");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(eventSchedulePayload(onSubmit.mock.lastCall?.[0])).toEqual({
      startsAt: new Date("2030-07-03T10:30").toISOString(),
      endsAt: null,
      startsOn: null,
      endsOn: null,
    });
    await user.click(screen.getByLabelText("End date"));
    await user.paste("Jul 12, 2030");
    expect(
      screen.getByText("Dates: Jul 3, 2030 to Jul 12, 2030"),
    ).toBeVisible();
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
      screen.getByText("Dates: Jul 3, 2030 to Jul 12, 2030"),
    ).toBeVisible();
  });

  it("moves the list to a typed month without changing or submitting the schedule", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Dates: Jul 3, 2030 to Jul 12, 2030"));
    await user.click(
      screen.getByRole("button", { name: /^Choose a month and year/ }),
    );
    await user.clear(screen.getByLabelText("Month and year"));
    await user.paste("July 2099");
    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("table", { name: "July 2099" })).toBeVisible();
    expect(screen.getByLabelText("Start date")).toHaveValue("Jul 3, 2030");
    expect(screen.getByLabelText("End date")).toHaveValue("Jul 12, 2030");
  });

  it("keeps text it cannot read out of the schedule and says so", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Dates: Jul 3, 2030 to Jul 12, 2030"));
    await user.click(screen.getByLabelText("Start date"));
    await user.paste("x");
    expect(screen.getByLabelText("Start date")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByText(/Not a date the picker knows/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(eventSchedulePayload(onSubmit.mock.lastCall?.[0]).startsOn).toBe(
      range.startDate,
    );
    // Clearing the start clears the range; an end before the new start is
    // refused until it is fixed.
    await user.clear(screen.getByLabelText("Start date"));
    expect(screen.getByText("Dates: not set")).toBeVisible();
    await user.paste("Jul 3, 2030");
    await user.click(screen.getByLabelText("End date"));
    await user.paste("Jul 1, 2030");
    expect(
      screen.getByText("The end cannot come before the start."),
    ).toBeVisible();
    expect(screen.getByText("Dates: Jul 3, 2030")).toBeVisible();
    await user.clear(screen.getByLabelText("End date"));
    await user.paste("Jul 5, 2030");
    expect(screen.getByText("Dates: Jul 3, 2030 to Jul 5, 2030")).toBeVisible();
  });

  it("locks all schedule controls during a pending save", async () => {
    const user = userEvent.setup();
    render(
      <Harness disabled initial={{ ...range, startDate: "", endDate: "" }} />,
    );
    expect(screen.getByLabelText("Start date")).toBeDisabled();
    expect(screen.getByLabelText("End date")).toBeDisabled();
    expect(
      within(
        screen.getByRole("list", { name: "Schedule shortcuts" }),
      ).getByRole("button", { name: /^Today/ }),
    ).toBeDisabled();
    await user.click(screen.getByRole("switch", { name: "Add times" }));
    expect(screen.queryByLabelText("Start time")).toBeNull();
  });

  it("clears hidden end times when removing a date-only end", async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={{ ...range, startTime: "10:30", endTime: "18:15" }} />,
    );
    await user.click(screen.getByText("Dates: Jul 3, 2030 to Jul 12, 2030"));
    await user.clear(screen.getByLabelText("End date"));
    await user.click(screen.getByRole("switch", { name: "Add times" }));
    expect(screen.getByLabelText<HTMLInputElement>("Start time").value).toBe(
      "10:30",
    );
    expect(
      screen.getByLabelText<HTMLInputElement>("End time (optional)").value,
    ).toBe("");
  });
});
