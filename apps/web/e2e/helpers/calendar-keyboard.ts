import { expect, type Page } from "@playwright/test";

export async function selectLeapDayRange(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Create an event" });
  await dialog.getByRole("switch", { name: "Set dates" }).check();
  await dialog.getByRole("button", { name: "Change year" }).click();
  await dialog.getByRole("button", { name: "2028", exact: true }).click();
  await dialog.getByRole("button", { name: "Change month" }).click();
  await dialog.getByRole("button", { name: "January", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Jan 31, 2028", exact: true })
    .focus();
  await page.keyboard.press("PageDown");
  await expect(
    dialog.getByRole("button", { name: "Feb 29, 2028", exact: true }),
  ).toBeFocused();
  await expect(
    dialog.getByRole("status", { name: "Calendar navigation" }),
  ).toHaveText("February 2028");
  await expect(
    dialog.getByRole("columnheader", { name: "Sunday", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Shift+PageDown");
  await expect(
    dialog.getByRole("button", { name: "Feb 28, 2029", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+PageUp");
  await expect(
    dialog.getByRole("button", { name: "Feb 28, 2028", exact: true }),
  ).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: "Start date: Choose a day" }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "End date: Mar 1, 2028" }),
  ).toBeVisible();
  await expect(dialog.getByRole("gridcell", { selected: true })).toHaveCount(3);
  await expect(
    dialog.getByRole("status", { name: "Calendar navigation" }),
  ).toHaveText("March 2028");
  // macOS WebKit uses Option-Tab to include native buttons in keyboard navigation.
  const tabKey =
    process.platform === "darwin" &&
    page.context().browser()?.browserType().name() === "webkit"
      ? "Alt+Tab"
      : "Tab";
  await page.keyboard.press(tabKey);
  await expect(
    dialog.getByRole("button", { name: "Today", exact: true }),
  ).toBeFocused();
  await expect(dialog.locator(".event-create-header")).toBeInViewport({
    ratio: 1,
  });
  await expect(dialog.locator(".event-create-footer")).toBeInViewport({
    ratio: 1,
  });
  expect(await dialog.evaluate((element) => element.scrollTop)).toBe(0);
}
