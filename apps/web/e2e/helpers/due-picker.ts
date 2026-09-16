import { expect, type Locator } from "@playwright/test";

/**
 * Sets a task's due through the Due control of an editor: opens it, types
 * the date, and adds the time when one is given.
 */
export async function setDue(
  editor: Locator,
  dueDate: string,
  dueTime?: string,
) {
  const summary = editor.locator("summary", { hasText: /^Due: / });
  if (!(await editor.getByLabel("Due date", { exact: true }).isVisible()))
    await summary.click();
  await editor.getByLabel("Due date", { exact: true }).fill(dueDate);
  if (dueTime !== undefined) {
    await editor.getByRole("button", { name: "Add time", exact: true }).click();
    await editor.getByLabel("Due time", { exact: true }).fill(dueTime);
  }
}

/** The closed Due control's reading of the choice. */
export async function expectDue(editor: Locator, text: string) {
  await expect(editor.locator("summary", { hasText: /^Due: / })).toHaveText(
    `Due: ${text}`,
  );
}
