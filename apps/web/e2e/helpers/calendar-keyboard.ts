import { expect, type Page } from "@playwright/test";
import { dayName, expectDates } from "./range-picker";

export async function selectLeapDayRange(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Create an event" });
  await dialog.getByRole("switch", { name: "Set dates" }).check();
  await dialog
    .getByRole("button", { name: /^Choose a month and year/ })
    .click();
  const chooser = dialog.getByRole("dialog", {
    name: "Choose a month and year",
  });
  await chooser.getByRole("button", { name: "2028", exact: true }).click();
  await chooser.getByRole("button", { name: "Jan", exact: true }).click();
  await chooser.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: /^Choose a month and year/ }),
  ).toHaveAccessibleName("Choose a month and year, showing January 2028");
  await dialog.getByRole("button", { name: dayName("2028-01-31") }).focus();
  await page.keyboard.press("PageDown");
  await expect(
    dialog.getByRole("button", { name: dayName("2028-02-29") }),
  ).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: /^Choose a month and year/ }),
  ).toHaveAccessibleName("Choose a month and year, showing February 2028");
  await expect(
    dialog.getByRole("columnheader", { name: "Sunday", exact: true }).first(),
  ).toBeAttached();
  await page.keyboard.press("Shift+PageDown");
  await expect(
    dialog.getByRole("button", { name: dayName("2029-02-28") }),
  ).toBeFocused();
  await page.keyboard.press("Shift+PageUp");
  await expect(
    dialog.getByRole("button", { name: dayName("2028-02-28") }),
  ).toBeFocused();
  await expectDates(dialog, "not set");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expectDates(dialog, "Feb 28, 2028 to Mar 1, 2028");
  await expect(
    dialog.locator('.month-list-day[aria-pressed="true"]'),
  ).toHaveCount(2);
  await expect(dialog.locator("td.is-between")).toHaveCount(1);
  await expect(dialog.locator(".event-create-header")).toBeInViewport({
    ratio: 1,
  });
  await expect(dialog.locator(".event-create-footer")).toBeInViewport({
    ratio: 1,
  });
  expect(await dialog.evaluate((element) => element.scrollTop)).toBe(0);
}
