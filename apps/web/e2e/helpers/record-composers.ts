import { expect, type Locator, type Page } from "@playwright/test";
import { closeDatePanel, datePanel } from "./date-rows";

/** The composer a row or an add row opened, named "Edit <name>" or for the new record. */
export const composer = (page: Page, name: string) =>
  page.getByRole("form", { name, exact: true });

/** A composer's chip, named for its field and reading its value. */
export const chip = (scope: Locator, name: RegExp) =>
  scope.getByRole("button", { name });

/** Presses a row's name to open it in place. */
export async function pressRow(scope: Locator | Page, name: string) {
  await scope
    .getByRole("button", { name: `Edit ${name}`, exact: true })
    .click();
}

/** Opens an add row's composer and types the name. */
export async function openAddComposer(
  scope: Locator,
  rowName: string,
  formName: string,
  displayName: string,
) {
  await scope.getByRole("button", { name: rowName, exact: true }).click();
  const page = scope.page();
  const form = composer(page, formName);
  await expect(form).toBeVisible();
  const name = form.getByRole("textbox").first();
  await expect(name).toBeFocused();
  await name.fill(displayName);
  return form;
}

/** Saves or adds from the composer's name field with Enter. */
export async function submitComposer(form: Locator) {
  await form.getByRole("textbox").first().press("Enter");
}

/**
 * Sets a schedule item's dates through its Dates chip: the span typed
 * into the panel, the times unfolded when a start time is given, Enter
 * closing the panel.
 */
export async function setSpanChip(
  form: Locator,
  span: string,
  times?: { readonly start: string; readonly end?: string },
) {
  await chip(form, /^Dates/).click();
  const typed = form.getByLabel("Type a date", { exact: true });
  await typed.fill(span);
  if (times !== undefined) {
    const line = form.getByRole("button", { name: "Times", exact: true });
    if (await line.isVisible()) await line.click();
    await form.getByLabel("Start", { exact: true }).fill(times.start);
    if (times.end !== undefined)
      await form.getByLabel("End", { exact: true }).fill(times.end);
  }
  await typed.press("Enter");
  await expect(datePanel(form)).toBeHidden();
}

/** Sets a moment through a chip whose panel opens with the time unfolded (Remind at, Paid on). */
export async function setMomentChip(
  form: Locator,
  name: RegExp,
  day: string,
  time: string,
) {
  await chip(form, name).click();
  await form.getByLabel("Type a date", { exact: true }).fill(day);
  await form.getByLabel("Time", { exact: true }).fill(time);
  await closeDatePanel(form);
}

/** Sets an expense's amount, and its currency, through the Amount chip. */
export async function setAmountChip(
  form: Locator,
  amount: string,
  currency?: string,
) {
  await chip(form, /^Amount/).click();
  const field = form.getByRole("textbox", { name: "Amount", exact: true });
  await field.fill(amount);
  if (currency !== undefined)
    await form
      .getByRole("textbox", { name: "Currency", exact: true })
      .fill(currency);
  await field.press("Enter");
}

/** Sets the place through the Place chip. */
export async function setPlaceChip(form: Locator, place: string) {
  await chip(form, /^Place/).click();
  const field = form.getByRole("textbox", { name: "Place", exact: true });
  await field.fill(place);
  await field.press("Enter");
}
