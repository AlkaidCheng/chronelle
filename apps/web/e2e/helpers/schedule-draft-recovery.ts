import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectToken } from "./appearance";
import { expectHorizontalReflow } from "./page-navigation";
import { expectDates } from "./date-rows";

export async function reopenScheduleDraft(page: Page) {
  const calendarUrl = page.url();
  const historyLength = await page.evaluate(() => window.history.length);
  await page.goBack();
  await expect(page).not.toHaveURL(calendarUrl);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(calendarUrl);
  expect(await page.evaluate(() => window.history.length)).toBe(historyLength);
}

/**
 * The draft the dialog kept is found by the add row's composer, which
 * comes back open with the name and the dates on its chip; More hands it
 * to the dialog again.
 */
export async function inspectScheduleRecovery(page: Page, testInfo: TestInfo) {
  const adding = page.getByRole("form", {
    name: "New schedule item",
    exact: true,
  });
  const name = adding.getByLabel("Schedule item", { exact: true });
  await expect(name).toHaveValue("Garden arrival");
  await expect(name).toBeFocused();
  await expect(
    adding.getByRole("button", { name: /^Dates: Jul 3, 2030 to Jul 5, 2030/ }),
  ).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 568 });
    await expectToken(adding, "background-color", "surface");
    await expectToken(name, "color", "ink");
    for (const set of await adding.locator(".chip.is-set").all())
      await expectToken(set, "color", "ink");
    await expectHorizontalReflow(page);
    await adding
      .getByRole("button", { name: "Add to schedule", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      adding.getByRole("button", { name: "Add to schedule", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`schedule-recovery-${colorScheme}.png`),
    });
  }
  await adding.getByRole("button", { name: /^More: / }).click();
  const dialog = page.getByRole("dialog", {
    name: "Add schedule item",
    exact: true,
  });
  await expect(dialog.getByLabel("Schedule item", { exact: true })).toHaveValue(
    "Garden arrival",
  );
  await expect(
    dialog.getByLabel("Schedule item", { exact: true }),
  ).toBeFocused();
  await expectDates(dialog, "Jul 3, 2030 to Jul 5, 2030");
}
