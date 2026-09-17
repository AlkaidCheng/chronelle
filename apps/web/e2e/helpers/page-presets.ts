import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectHorizontalReflow } from "./page-navigation";
import { choosePageOption } from "./quiet-chrome";

export async function exercisePagePresets(page: Page, testInfo: TestInfo) {
  const add = page.getByRole("button", { name: "Add page", exact: true });
  const dialog = page.getByRole("dialog", { name: "Add a page" });
  const name = dialog.getByRole("textbox", { name: "Page name" });
  const preview = dialog.getByRole("region", { name: "Page preview" });
  await add.click();
  await expect(name).toBeFocused();
  await expect(
    dialog.getByRole("radio", { name: "Blank", exact: true }),
  ).toBeChecked();
  await name.fill("Preparation");
  await dialog.getByRole("button", { name: "Add page", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Preparation", exact: true }),
  ).toBeVisible();
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(name).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("radio", { name: "Blank", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(
    dialog.getByRole("radio", { name: "Gathering", exact: true }),
  ).toBeChecked();
  await expect(name).toHaveValue("Gathering");
  await expect(preview.getByRole("listitem")).toHaveText([
    "To-dos",
    "Calendar",
    "Expenses",
  ]);
  await name.fill("On the day");
  await dialog.getByRole("radio", { name: "Multi-day", exact: true }).check();
  await expect(name).toHaveValue("On the day");
  await expect(preview.getByRole("listitem")).toHaveText(["Calendar", "Files"]);
  await dialog.getByRole("radio", { name: "Gathering", exact: true }).check();
  await dialog.screenshot({
    path: testInfo.outputPath("preset-desktop.png"),
    animations: "disabled",
  });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 320, height: 568 });
    await expectHorizontalReflow(page);
    await expect(
      dialog.getByRole("button", { name: "Add page", exact: true }),
    ).toBeInViewport();
    await preview.scrollIntoViewIfNeeded();
    await expect(preview.getByRole("listitem").last()).toBeInViewport();
    await dialog.screenshot({
      path: testInfo.outputPath(`preset-narrow-${colorScheme}.png`),
      animations: "disabled",
    });
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Preparation", exact: true }),
  ).toBeVisible();
  await add.click();
  await dialog.getByRole("radio", { name: "Gathering", exact: true }).check();
  await name.fill("On the day");
  await name.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
  await expect(
    page.getByText("On the day page added.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: /component [123]$/ }),
  ).toHaveCount(3);
  await add.click();
  await dialog.getByRole("radio", { name: "Multi-day", exact: true }).check();
  await dialog.getByRole("button", { name: "Add page", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await choosePageOption(page, "Page options");
  const recovery = page.getByRole("dialog", { name: "Manage event pages" });
  await recovery.getByRole("button", { name: "Undo layout change" }).click();
  await expect(
    recovery.getByRole("heading", { name: "Multi-day", exact: true }),
  ).toHaveCount(0);
  await recovery.getByRole("button", { name: "Redo layout change" }).click();
  await expect(
    recovery.getByRole("heading", { name: "Multi-day", exact: true }),
  ).toBeVisible();
  await recovery.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Multi-day", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Calendar component 1", exact: true }),
  ).toBeVisible();
  await choosePageOption(page, "Page options");
  await recovery
    .getByRole("button", { name: "Layout history", exact: true })
    .click();
  await recovery
    .getByRole("button", { name: "Preview version 3", exact: true })
    .click();
  await expect(
    recovery.getByText("Calendar, Files", { exact: false }),
  ).toBeVisible();
  await recovery.getByRole("button", { name: "Back", exact: true }).click();
  await recovery.getByRole("button", { name: "Close", exact: true }).click();
}
