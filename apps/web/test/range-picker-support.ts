import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { parseDayKey } from "../lib/day-placement";

const fullDay = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

/** A day button's accessible name on the month list. */
export const dayName = (key: string) => fullDay.format(parseDayKey(key));

/** Types a start, and an end, into the open range picker's fields. */
export async function setDates(user: UserEvent, start: string, end = "") {
  await user.click(screen.getByLabelText("Start date"));
  await user.paste(start);
  if (end !== "") {
    await user.click(screen.getByLabelText("End date"));
    await user.paste(end);
  }
}
