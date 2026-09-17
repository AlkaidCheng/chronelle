import { expect, type Locator, type Page } from "@playwright/test";

/** The outcome notice at the foot of the page that reads the given text. */
export const outcomeNotice = (page: Page, text: string) =>
  page.locator(".notice-toast", { hasText: text });

/**
 * Moves the open dialog's record to Trash: the verb, its one-line
 * confirmation, and the notice that follows once the dialog has closed.
 */
export async function moveToTrash(page: Page, dialog: Locator) {
  await dialog
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await expect(dialog).toContainText("You can restore it from Trash.");
  await dialog
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(outcomeNotice(page, "Moved to Trash")).toBeVisible();
}

/** Removes the open dialog's record from its event; no confirmation. */
export async function removeFromEvent(page: Page, dialog: Locator) {
  await dialog
    .getByRole("button", { name: "Remove from this event", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(outcomeNotice(page, "Removed from this event")).toBeVisible();
}
