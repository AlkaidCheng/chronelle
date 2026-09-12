import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectHorizontalReflow } from "./page-navigation";

export async function exerciseWorkspaceCommands(
  page: Page,
  testInfo: TestInfo,
) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const trigger = page.getByRole("button", { name: "Commands", exact: true });
  const dialog = page.getByRole("dialog", { name: "Commands", exact: true });
  const results = dialog.getByRole("listbox", {
    name: "Commands",
  });
  await page.getByRole("button", { name: "Browse event data" }).click();
  await page.getByRole("tab", { name: "To-dos", exact: true }).click();
  const addTask = page.getByRole("button", { name: "Add task", exact: true });
  await addTask.click();
  const draft = page.getByLabel("Task", { exact: true });
  await draft.fill("Unsaved command draft");
  await page.keyboard.press("Control+k");
  await expect(dialog).toHaveCount(0);
  await expect(draft).toBeFocused();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(draft).toHaveValue("Unsaved command draft");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(addTask).toBeFocused();
  const filter = page.getByRole("button", { name: "all", exact: true });
  await filter.click();
  await trigger.focus();
  await page.keyboard.press("Control+k");
  const input = dialog.getByRole("combobox", { name: "Find a command" });
  await expect(input).toBeFocused();
  await expect(
    results.getByRole("group", { name: "Navigation" }).getByRole("option"),
  ).toHaveCount(3);
  const firstCommandId = await results
    .getByRole("option")
    .first()
    .getAttribute("id");
  await page.keyboard.press("ArrowUp");
  await expect(results.getByRole("option", { selected: true })).toContainText(
    "Trash",
  );
  await page.keyboard.press("ArrowDown");
  await expect(results.getByRole("option", { selected: true })).toHaveAttribute(
    "id",
    firstCommandId ?? "",
  );
  await input.fill("nothing matches");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toContainText(
    "No accessible records found",
  );
  await input.fill("");
  await page.screenshot({ path: testInfo.outputPath("commands.png") });
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate(
        (element) =>
          document.activeElement === document.body ||
          element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(filter).toHaveAttribute("aria-pressed", "true");

  await page.setViewportSize({ width: 320, height: 568 });
  await trigger.click();
  await expectHorizontalReflow(page);
  await input.fill("trash");
  await expect(dialog.getByRole("option", { name: /Trash/ })).toBeInViewport();
  await input.fill("");
  await dialog.getByText("Keyboard shortcuts", { exact: true }).click();
  const enable = dialog.getByRole("checkbox", {
    name: "Enable command shortcut",
  });
  await enable.uncheck();
  await page.screenshot({
    path: testInfo.outputPath("commands-help-narrow.png"),
  });
  await dialog.getByRole("button", { name: "Close commands" }).click();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  await dialog.getByText("Keyboard shortcuts", { exact: true }).click();
  await expect(enable).not.toBeChecked();
  await enable.check();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "More", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Workspace settings" });
  await page.keyboard.press("Control+k");
  await expect(dialog).toHaveCount(0);
  await settings.getByRole("radio", { name: "Dark", exact: true }).check();
  await page.keyboard.press("Escape");
  await trigger.click();
  await expectHorizontalReflow(page);
  await page.screenshot({
    path: testInfo.outputPath("commands-dark-narrow.png"),
  });
  await page.setViewportSize({ width: 568, height: 320 });
  await input.focus();
  await page.keyboard.press("ArrowUp");
  await expect(
    results.getByRole("option", { selected: true }),
  ).toBeInViewport();
  await expect(
    dialog.getByRole("button", { name: "Close commands" }),
  ).toBeInViewport();
  await expectHorizontalReflow(page);
  await input.fill("search");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/search$/);
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  await dialog.getByRole("option", { name: /Trash/ }).click();
  await expect(page).toHaveURL(/\/trash$/);
  expect(errors).toEqual([]);
}
