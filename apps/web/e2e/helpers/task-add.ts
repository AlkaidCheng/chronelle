import type { Locator, Page } from "@playwright/test";

/**
 * Opens the full editor for a new task the way a person does: the quick
 * add row (the first one in scope), then its details control.
 */
export async function openTaskEditor(
  page: Page,
  scope: Locator | Page = page,
): Promise<void> {
  await scope
    .getByRole("button", { name: /^Add a task/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Add task with details", exact: true })
    .click();
}
