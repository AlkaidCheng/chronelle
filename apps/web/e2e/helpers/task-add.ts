import type { Locator, Page } from "@playwright/test";

/**
 * Opens the full editor for a new task the way a person does: the quick
 * add row (the first one in scope), then its details control.
 */
export async function openTaskEditor(
  page: Page,
  scope: Locator | Page = page,
): Promise<void> {
  await openPlanningEditor(page, "task", scope);
}

/**
 * Opens the editor for a new record of a kind: a task or a reminder through
 * its quick add row and the row's details control, an expense or a schedule
 * item through the add row at the end of its collection.
 */
export async function openPlanningEditor(
  page: Page,
  kind: "task" | "reminder" | "expense" | "schedule item",
  scope: Locator | Page = page,
): Promise<void> {
  if (kind === "expense" || kind === "schedule item") {
    await scope
      .getByRole("button", { name: `Add ${kind}`, exact: true })
      .click();
    return;
  }
  await scope
    .getByRole("button", { name: new RegExp(`^Add a ${kind}`) })
    .first()
    .click();
  await page
    .getByRole("button", { name: `Add ${kind} with details`, exact: true })
    .click();
}
