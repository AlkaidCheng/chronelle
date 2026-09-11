import { expect, test } from "@playwright/test";
import { selectLeapDayRange } from "../../e2e/helpers/calendar-keyboard";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("navigates months and years without changing the selected range", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  await page.goto(sandboxUrl);
  const trigger = page.getByRole("button", { name: "New event", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Create an event" });
  await expect(dialog.getByLabel("Event name", { exact: true })).toBeFocused();
  await selectLeapDayRange(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("keyboard-date-range.png"),
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("distinguishes a tentative hover range from selected dates", async ({
  page,
}) => {
  await page.goto(sandboxUrl);
  await page.getByRole("button", { name: "New event", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create an event" });
  await dialog.getByRole("switch", { name: "Set dates" }).check();
  await dialog.getByRole("button", { name: "Change year" }).click();
  await dialog.getByRole("button", { name: "2030", exact: true }).click();
  await dialog.getByRole("button", { name: "Change month" }).click();
  await dialog.getByRole("button", { name: "July", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Jul 3, 2030", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Jul 12, 2030", exact: true })
    .hover();
  await expect(dialog.locator('[data-in-range="true"]')).toHaveCount(10);
  await expect(dialog.getByRole("gridcell", { selected: true })).toHaveCount(1);
  await dialog
    .getByRole("button", { name: "Jul 12, 2030", exact: true })
    .click();
  await expect(dialog.getByRole("gridcell", { selected: true })).toHaveCount(
    10,
  );
  await dialog
    .getByRole("button", { name: "Clear dates", exact: true })
    .click();
  await expect(dialog.getByRole("gridcell", { selected: true })).toHaveCount(0);
});
