import { expect, test } from "@playwright/test";
import { selectLeapDayRange } from "../../e2e/helpers/calendar-keyboard";
import {
  datesRow,
  dayName,
  expectDates,
  expectNoDates,
  openDatePanel,
} from "../../e2e/helpers/date-rows";

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
  // The first Escape closes the panel, focus back on its row; the next asks.
  await page.keyboard.press("Escape");
  await expect(datesRow(dialog)).toBeFocused();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("chooses a span by dragging across days and clears it from the typed field", async ({
  page,
}) => {
  await page.goto(sandboxUrl);
  await page.getByRole("button", { name: "New event", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create an event" });
  await openDatePanel(dialog, datesRow(dialog));
  await dialog
    .getByRole("button", { name: /^Choose a month and year/ })
    .click();
  await dialog.getByLabel("Month and year", { exact: true }).fill("July 2030");
  await dialog.getByLabel("Month and year", { exact: true }).press("Enter");
  const from = dialog.getByRole("button", { name: dayName("2030-07-03") });
  const to = dialog.getByRole("button", { name: dayName("2030-07-12") });
  const [a, b] = await Promise.all([from.boundingBox(), to.boundingBox()]);
  if (!a || !b) throw new Error("The days are not laid out.");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  // The range follows the pointer before it is released.
  await expectDates(dialog, "Jul 3, 2030 to Jul 12, 2030");
  await page.mouse.up();
  await expectDates(dialog, "Jul 3, 2030 to Jul 12, 2030");
  await expect(
    dialog.locator('.month-list-day[aria-pressed="true"]'),
  ).toHaveCount(2);
  await expect(dialog.locator("td.is-between")).toHaveCount(8);
  // A plain click after the drag starts a new range.
  await dialog.getByRole("button", { name: dayName("2030-07-20") }).click();
  await expectDates(dialog, "Jul 20, 2030");
  await dialog.getByLabel("Type a date", { exact: true }).fill("");
  await expectNoDates(dialog);
  await expect(
    dialog.locator('.month-list-day[aria-pressed="true"]'),
  ).toHaveCount(0);
});
