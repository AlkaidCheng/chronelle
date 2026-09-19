import { expect, type Locator } from "@playwright/test";

const fullDay = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** A day button's accessible name on the month list. */
export const dayName = (date: string) =>
  fullDay.format(new Date(`${date}T00:00:00Z`));

/** The row of a field set through the date panel: named for the field, reading its value. */
export const dateRow = (scope: Locator, name: RegExp) =>
  scope.getByRole("button", { name });

export const datesRow = (scope: Locator) =>
  dateRow(scope, /^(Set dates|Dates)/);
export const timesRow = (scope: Locator) =>
  dateRow(scope, /^(Set times|Times)/);
export const dueRow = (scope: Locator) =>
  dateRow(scope, /^(Set due date|Due date)/);

/** The open date panel, under whichever row opened it. */
export const datePanel = (scope: Locator) => scope.locator(".date-panel");

/** Opens a row's panel when it is closed. */
export async function openDatePanel(scope: Locator, row: Locator) {
  if (!(await datePanel(scope).isVisible())) await row.click();
  await expect(datePanel(scope)).toBeVisible();
  return datePanel(scope);
}

/** Closes the open panel from its typed field, focus returning to the row. */
export async function closeDatePanel(scope: Locator) {
  await scope.getByLabel("Type a date", { exact: true }).press("Escape");
  await expect(datePanel(scope)).toBeHidden();
}

/** Types a start, and an end, as one span into the dates row's panel, and closes it. */
export async function setDates(scope: Locator, start: string, end = "") {
  await openDatePanel(scope, datesRow(scope));
  const typed = scope.getByLabel("Type a date", { exact: true });
  await typed.fill(end === "" ? start : `${start} to ${end}`);
  await typed.press("Enter");
  await expect(datePanel(scope)).toBeHidden();
}

/** Types a start time, and an end time, into the times row's panel, and closes it. */
export async function setTimes(scope: Locator, start: string, end = "") {
  await openDatePanel(scope, timesRow(scope));
  await scope.getByLabel("Start", { exact: true }).fill(start);
  if (end !== "") await scope.getByLabel("End", { exact: true }).fill(end);
  await closeDatePanel(scope);
}

/** Expects the dates row to read the span. */
export async function expectDates(scope: Locator, text: string) {
  await expect(datesRow(scope)).toHaveText(`Dates: ${text}`);
}

/** Expects the dates row to offer setting dates, none being set. */
export async function expectNoDates(scope: Locator) {
  await expect(datesRow(scope)).toHaveText(/^Set dates/);
}

/** Expects the times row to read the times. */
export async function expectTimes(scope: Locator, text: string) {
  await expect(timesRow(scope)).toHaveText(`Times: ${text}`);
}

/**
 * Sets a task's due through the Due row of an editor: opens the panel,
 * types the date, adds the time when one is given, and the repeat (by its
 * label, such as "Every week") when one is given, then closes it and
 * chooses the duration (in minutes) when one is given.
 */
export async function setDue(
  editor: Locator,
  dueDate: string,
  dueTime?: string,
  duration?: number,
  repeat?: string,
) {
  await openDatePanel(editor, dueRow(editor));
  await editor.getByLabel("Type a date", { exact: true }).fill(dueDate);
  if (dueTime !== undefined) {
    const line = editor.getByRole("button", { name: "Time", exact: true });
    if (await line.isVisible()) await line.click();
    await editor.getByLabel("Time", { exact: true }).fill(dueTime);
  }
  if (repeat !== undefined) {
    const line = editor.getByRole("button", { name: "Repeat", exact: true });
    if (await line.isVisible()) await line.click();
    await editor
      .getByLabel("Repeat", { exact: true })
      .selectOption({ label: repeat });
  }
  await closeDatePanel(editor);
  if (duration !== undefined)
    await editor
      .getByLabel("Duration", { exact: true })
      .selectOption(String(duration));
}

/** Expects the Due row to read the choice. */
export async function expectDue(editor: Locator, text: string) {
  await expect(dueRow(editor)).toHaveText(`Due date: ${text}`);
}

/** The rows of the editors that take one moment: a day and a time. */
export const momentRows = {
  expense: /^(Set the day it was paid|Paid on)/,
  reminder: /^(Set reminder time|Reminder time)/,
} as const;

/** Sets a moment's row: opens its panel, with the time unfolded, types both, and closes it. */
export async function setMoment(
  editor: Locator,
  row: RegExp,
  day: string,
  time: string,
) {
  await openDatePanel(editor, dateRow(editor, row));
  await editor.getByLabel("Type a date", { exact: true }).fill(day);
  await editor.getByLabel("Time", { exact: true }).fill(time);
  await closeDatePanel(editor);
}

/** Expects a moment's row to read the day and time, as "Jul 3, 2030, 11:30 AM". */
export async function expectMoment(editor: Locator, row: RegExp, text: string) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await expect(dateRow(editor, row)).toHaveText(new RegExp(`: ${escaped}$`));
}
