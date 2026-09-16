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

/** The range picker's summary, which opens its fields and month list. */
export const datesSummary = (scope: Locator) =>
  scope.locator("summary", { hasText: /^Dates: / });

/**
 * Types a start, and an end, into the range picker. The picker opens on its
 * own without dates; with dates, the summary opens it.
 */
export async function setDates(scope: Locator, start: string, end = "") {
  if (!(await scope.getByLabel("Start date", { exact: true }).isVisible()))
    await datesSummary(scope).click();
  await scope.getByLabel("Start date", { exact: true }).fill(start);
  if (end !== "") await scope.getByLabel("End date", { exact: true }).fill(end);
}

/** Expects the closed control to read the range. */
export async function expectDates(scope: Locator, text: string) {
  await expect(datesSummary(scope)).toHaveText(`Dates: ${text}`);
}
