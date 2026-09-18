import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectHorizontalReflow } from "./page-navigation";
import { searchEntry } from "./quiet-chrome";
import { openTaskEditor } from "./task-add";

export async function exerciseEditorSubmit(page: Page, testInfo: TestInfo) {
  await page.getByRole("button", { name: "New event", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Create an event",
    exact: true,
  });
  const name = dialog.getByLabel("Event name", { exact: true });
  await name.press("Control+Enter");
  await expect(dialog).toBeVisible();
  expect(
    await name.evaluate(
      (input: HTMLInputElement) => input.validity.valueMissing,
    ),
  ).toBe(true);
  await name.fill("Editor shortcut plan");
  await name.dispatchEvent("compositionstart");
  await name.press("Control+Enter");
  await expect(dialog).toBeVisible();
  await name.dispatchEvent("compositionend");
  for (const extra of [
    { isComposing: true },
    { keyCode: 229 },
    { repeat: true },
  ]) {
    await name.dispatchEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      ...extra,
    });
    await expect(dialog).toBeVisible();
  }
  await dialog.getByRole("switch", { name: "Set dates", exact: true }).click();
  await name.press("Control+Enter");
  await expect(dialog.getByRole("alert")).toHaveText("Choose a start date.");
  await dialog.getByRole("switch", { name: "Set dates", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 568 });
  await expectHorizontalReflow(page);
  await page.screenshot({
    path: testInfo.outputPath("editor-submit-create-narrow.png"),
  });
  await name.press("Meta+Enter");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Editor shortcut plan", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "To-dos", exact: true }).click();
  await openTaskEditor(page);
  const task = page.getByLabel("Task", { exact: true });
  const save = page.getByRole("button", { name: "Create task", exact: true });
  await task.fill("Keyboard-created task");
  await task.press("Control+Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add a task to the list", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByText("Keyboard-created task", { exact: true }),
  ).toHaveCount(1);
  const commands = page.getByRole("dialog", { name: "Search", exact: true });
  await searchEntry(page).click();
  await commands.getByText("Keyboard shortcuts", { exact: true }).click();
  const preference = commands.getByLabel("Enable editor submit shortcut", {
    exact: true,
  });
  await preference.uncheck();
  await preference.scrollIntoViewIfNeeded();
  await expectHorizontalReflow(page);
  await page.screenshot({
    path: testInfo.outputPath("editor-submit-preference-narrow.png"),
  });
  await page.keyboard.press("Escape");
  await openTaskEditor(page);
  await task.fill("Retained draft");
  await expect(save).not.toHaveAttribute("aria-keyshortcuts");
  await expect(task).toHaveValue("Retained draft");
  await task.press("Control+Enter");
  await task.press("Meta+Enter");
  await expect(task).toHaveValue("Retained draft");
  await save.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Retained draft", { exact: true })).toHaveCount(
    1,
  );
  await page.reload();
  await openTaskEditor(page);
  await expect(save).not.toHaveAttribute("aria-keyshortcuts");
  await page.keyboard.press("Escape");
  await searchEntry(page).click();
  await commands.getByText("Keyboard shortcuts", { exact: true }).click();
  await expect(preference).not.toBeChecked();
  await commands
    .getByRole("button", { name: "Reset keyboard shortcuts" })
    .click();
  await expect(preference).toBeChecked();
  await page.keyboard.press("Escape");
  await openTaskEditor(page);
  await expect(save).toHaveAttribute(
    "aria-keyshortcuts",
    "Control+Enter Meta+Enter",
  );
  await expectHorizontalReflow(page);
}
