import { fireEvent, screen, within } from "@testing-library/react";
import type { UserEvent as User } from "@testing-library/user-event";

/** A composer's chip, named for its field and reading its value. */
export function chip(name: RegExp, scope: HTMLElement = document.body) {
  return within(scope).getByRole("button", { name });
}

/**
 * Sets a schedule item's dates through its Dates chip: opens the panel,
 * types the span, unfolds the times when a start time is given, and
 * closes with Enter.
 */
export async function setSpanChip(
  user: User,
  span: string,
  times?: { readonly start: string; readonly end?: string },
  scope: HTMLElement = document.body,
) {
  await user.click(chip(/^Dates/, scope));
  const typed = screen.getByLabelText("Type a date");
  fireEvent.change(typed, { target: { value: span } });
  if (times !== undefined) {
    const line = screen.queryByRole("button", { name: /^Times$/ });
    if (line !== null) await user.click(line);
    fireEvent.change(screen.getByLabelText("Start"), {
      target: { value: times.start },
    });
    if (times.end !== undefined)
      fireEvent.change(screen.getByLabelText("End"), {
        target: { value: times.end },
      });
  }
  fireEvent.keyDown(typed, { key: "Enter" });
}

/**
 * Sets a moment through a chip that opens the date panel with its time
 * unfolded (Remind at, Paid on): types the day and the time, Enter closes.
 */
export async function setMomentChip(
  user: User,
  name: RegExp,
  day: string,
  time: string,
  scope: HTMLElement = document.body,
) {
  await user.click(chip(name, scope));
  const typed = screen.getByLabelText("Type a date");
  fireEvent.change(typed, { target: { value: day } });
  fireEvent.change(screen.getByLabelText("Time"), { target: { value: time } });
  fireEvent.keyDown(typed, { key: "Enter" });
}

/** Sets an expense's amount and currency through its Amount chip. */
export async function setAmountChip(
  user: User,
  amount: string,
  currency?: string,
  scope: HTMLElement = document.body,
) {
  await user.click(chip(/^Amount/, scope));
  const field = screen.getByRole("textbox", { name: "Amount" });
  fireEvent.change(field, { target: { value: amount } });
  if (currency !== undefined)
    fireEvent.change(screen.getByRole("textbox", { name: "Currency" }), {
      target: { value: currency },
    });
  fireEvent.keyDown(field, { key: "Enter" });
}
