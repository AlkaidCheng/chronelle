import type { Locator, Page } from "@playwright/test";

/**
 * Opens the full editor for a new task the way a person does: the add row
 * (the first one in scope) opens the composer, and More at its foot opens
 * the editor with the composer's fields.
 */
export async function openTaskEditor(
  page: Page,
  scope: Locator | Page = page,
): Promise<void> {
  await openPlanningEditor(page, "task", scope);
}

/** The add row of each kind; the first in scope for the kinds with day groups. */
const addRows = {
  task: /^Add a task/,
  reminder: /^Add a reminder/,
  expense: /^Add expense$/,
  "schedule item": /^Add schedule item$/,
} as const;

/**
 * Opens the editor for a new record of a kind the way a person does: the
 * add row at the end of its list opens the composer, and More at the
 * composer's foot opens the editor with the composer's fields.
 */
export async function openPlanningEditor(
  page: Page,
  kind: keyof typeof addRows,
  scope: Locator | Page = page,
): Promise<void> {
  await scope.getByRole("button", { name: addRows[kind] }).first().click();
  await page.getByRole("button", { name: /^More: / }).click();
}
