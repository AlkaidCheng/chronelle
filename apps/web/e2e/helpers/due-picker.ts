import { expect, type Locator } from "@playwright/test";

/**
 * Sets a task's due through the Due control of an editor: opens it, types
 * the date, adds the time when one is given, chooses the duration (in
 * minutes) when one is given, and the repeat (by its label, such as
 * "Every week") when one is given.
 */
export async function setDue(
  editor: Locator,
  dueDate: string,
  dueTime?: string,
  duration?: number,
  repeat?: string,
) {
  const summary = editor.locator("summary", { hasText: /^Due: / });
  if (!(await editor.getByLabel("Due date", { exact: true }).isVisible()))
    await summary.click();
  await editor.getByLabel("Due date", { exact: true }).fill(dueDate);
  if (dueTime !== undefined) {
    await editor.getByRole("button", { name: "Add time", exact: true }).click();
    await editor.getByLabel("Due time", { exact: true }).fill(dueTime);
  }
  if (duration !== undefined)
    await editor
      .getByLabel("Duration", { exact: true })
      .selectOption(String(duration));
  if (repeat !== undefined)
    await editor
      .getByLabel("Repeat", { exact: true })
      .selectOption({ label: repeat });
}

/** The closed Due control's reading of the choice. */
export async function expectDue(editor: Locator, text: string) {
  await expect(editor.locator("summary", { hasText: /^Due: / })).toHaveText(
    `Due: ${text}`,
  );
}
