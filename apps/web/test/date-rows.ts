import { fireEvent, screen, within } from "@testing-library/react";
import type { UserEvent as User } from "@testing-library/user-event";

import { parseDayKey } from "../lib/day-placement";

const fullDay = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

/** A day button's accessible name on the month list. */
export const dayName = (key: string) => fullDay.format(parseDayKey(key));

/** Sets a schedule's dates through its row: a start, and an end, typed as one span. */
export async function setDates(user: User, start: string, end = "") {
  await setRowDate(
    user,
    /^(Set dates|Dates)/,
    end === "" ? start : `${start} to ${end}`,
  );
}

/** Sets a schedule's times through its row, on dates already set. */
export async function setTimes(user: User, start: string, end = "") {
  await openDatePanel(user, /^(Set times|Times)/);
  fireEvent.change(screen.getByLabelText("Start"), {
    target: { value: start },
  });
  if (end !== "")
    fireEvent.change(screen.getByLabelText("End"), { target: { value: end } });
  fireEvent.keyDown(screen.getByLabelText("Type a date"), { key: "Enter" });
}

/** The row of a field set through the date panel: named for the field, reading its value. */
export function dateRow(name: RegExp, scope: HTMLElement = document.body) {
  return within(scope).getByRole("button", { name });
}

/** Opens a row's date panel and returns it. */
export async function openDatePanel(
  user: User,
  name: RegExp,
  scope: HTMLElement = document.body,
) {
  await user.click(dateRow(name, scope));
  const panel = screen.getByLabelText("Type a date").closest(".date-panel");
  if (!(panel instanceof HTMLElement)) throw new Error("The panel is closed.");
  return panel;
}

/**
 * Sets a field through its row: opens the panel, types the day (a span as
 * "start to end"), sets the time when given, and closes with Enter.
 */
export async function setRowDate(
  user: User,
  name: RegExp,
  text: string,
  time?: string,
  scope: HTMLElement = document.body,
) {
  await openDatePanel(user, name, scope);
  const typed = screen.getByLabelText("Type a date");
  fireEvent.change(typed, { target: { value: text } });
  if (time !== undefined) {
    const line = screen.queryByRole("button", { name: /^Time$/ });
    if (line !== null) await user.click(line);
    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: time },
    });
  }
  fireEvent.keyDown(typed, { key: "Enter" });
}
