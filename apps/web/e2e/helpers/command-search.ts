import { expect, type Page, type TestInfo } from "@playwright/test";
import { openCommands } from "./context-commands";
import { expectHorizontalReflow } from "./page-navigation";

export async function exerciseCommandSearch(page: Page, testInfo: TestInfo) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const dialog = await openCommands(page);
  const input = dialog.getByRole("combobox", { name: "Find a command" });
  await expect(dialog.getByRole("group", { name: "Records" })).toHaveCount(0);
  await input.fill("autumn");
  const event = dialog.getByRole("option", { name: /Autumn gathering/ });
  await expect(event).toHaveAttribute("aria-selected", "true");
  await input.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]+(?:\?.*)?$/);
  await expect(
    page.getByRole("heading", { name: "Autumn gathering", exact: true }),
  ).toBeVisible();
  const eventUrl = page.url();
  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  const draft = page.getByLabel("Name", { exact: true });
  await draft.fill("Unsaved autumn draft");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 320, height: 568 });
    await openCommands(page);
    await input.fill("garden");
    const task = dialog.getByRole("option", {
      name: /Confirm the garden venue/,
    });
    await expect(task).toHaveAttribute("aria-selected", "true");
    await expect(task).toContainText("task / Open event");
    await expectHorizontalReflow(page);
    await expect(task).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`command-search-${colorScheme}.png`),
    });
    await input.press("Escape");
    await expect(draft).toHaveValue("Unsaved autumn draft");
  }
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await openCommands(page);
  await input.fill("garden");
  await dialog
    .getByRole("option", { name: /Confirm the garden venue/ })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(eventUrl);
  expect(errors).toEqual([]);
}
