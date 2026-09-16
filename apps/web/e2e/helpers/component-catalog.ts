import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectHorizontalReflow } from "./page-navigation";

export async function exerciseComponentCatalog(page: Page, testInfo: TestInfo) {
  const destination = "During the event: activities, people, and places";
  const picker = page.getByRole("dialog", { name: "Add a component" });
  const add = page.getByRole("button", { name: "Add component", exact: true });
  const search = picker.getByRole("searchbox", { name: "Find a component" });
  for (const name of ["Preparation", destination]) {
    await page.getByRole("button", { name: "Add page", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add a page" });
    await dialog.getByLabel("Page name").fill(name);
    await dialog.getByRole("button", { name: "Add page", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    if (name === "Preparation") {
      await add.click();
      await picker.getByRole("button", { name: "Add To-dos" }).click();
      await expect(picker).toHaveCount(0);
    }
  }
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(search).toBeFocused();
  await expect(search).toHaveAccessibleDescription(`Add to ${destination}.`);
  await expect(picker.getByRole("radio")).toHaveCount(8);
  await expect(
    picker.getByText(/To-dos is already used on another page/),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(
    picker.getByRole("radio", { name: "To-dos", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    picker.getByRole("radio", { name: "Calendar", exact: true }),
  ).toBeChecked();
  await expect(
    picker.getByRole("button", { name: "Add Calendar" }),
  ).toBeEnabled();
  await search.fill("not a component");
  await expect(picker.getByRole("radio")).toHaveCount(0);
  await expect(
    picker.getByRole("button", { name: "Add component" }),
  ).toBeDisabled();
  await picker.getByRole("button", { name: "Clear search" }).click();
  await expect(search).toBeFocused();
  await expect(picker.getByRole("radio")).toHaveCount(8);
  await picker.screenshot({
    path: testInfo.outputPath("catalog-default.png"),
    animations: "disabled",
  });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 320, height: 568 });
    await search.fill("alerts");
    await expect(
      picker.getByRole("radio", { name: "Reminders", exact: true }),
    ).toBeChecked();
    await expect(
      picker.getByText(/Notifications are not sent yet/),
    ).toBeVisible();
    await expectHorizontalReflow(page);
    await expect(
      picker.getByRole("button", { name: "Add Reminders" }),
    ).toBeInViewport();
    await picker.screenshot({
      path: testInfo.outputPath(`catalog-narrow-${colorScheme}.png`),
      animations: "disabled",
    });
  }
  await search.fill("checklist");
  await expect(
    picker.getByText(/To-dos is already used on another page/),
  ).toBeInViewport();
  await picker.screenshot({
    path: testInfo.outputPath("catalog-repeated-view.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Enter");
  await expect(picker).toHaveCount(0);
  await expect(add).toBeFocused();
  await expect(
    page.getByText(`To-dos added to ${destination}.`, { exact: true }),
  ).toBeVisible();
  await add.click();
  await expect(
    picker.getByText(/To-dos is already used on this page/),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(add).toBeFocused();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: destination, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "To-dos component 1", exact: true }),
  ).toBeVisible();
}
