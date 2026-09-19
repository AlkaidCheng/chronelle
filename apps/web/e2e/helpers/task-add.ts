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

/** The add row and the composer of each kind; the first add row in scope for the kinds with day groups. */
const kinds = {
  task: { addRow: /^Add a task/, form: "New task" },
  reminder: { addRow: /^Add a reminder/, form: "New reminder" },
  expense: { addRow: /^Add expense$/, form: "New expense" },
  "schedule item": {
    addRow: /^Add schedule item$/,
    form: "New schedule item",
  },
} as const;

/**
 * Opens the editor for a new record of a kind: the add row at the end of
 * its list opens the composer (or the composer is already open, with a
 * draft it found), and More at the composer's foot opens the editor with
 * the composer's fields. A draft whose save is on its way, or failed,
 * opens the editor from the row itself, which asks about it.
 */
export async function openPlanningEditor(
  page: Page,
  kind: keyof typeof kinds,
  scope: Locator | Page = page,
): Promise<void> {
  const { addRow, form } = kinds[kind];
  const composer = scope.getByRole("form", { name: form, exact: true });
  if (!(await composer.isVisible()))
    await scope.getByRole("button", { name: addRow }).first().click();
  const more = composer.getByRole("button", { name: /^More: / });
  const dialog = page.getByRole("dialog");
  await Promise.race([
    more.waitFor({ state: "visible" }),
    dialog.first().waitFor({ state: "visible" }),
  ]);
  if (await more.isVisible()) await more.click();
}
