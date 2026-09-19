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
  // The dialog's draft is its own: the add row opens the composer empty,
  // and More reaches the dialog, which offers the draft.
  await page
    .getByRole("button", { name: "Add schedule item", exact: true })
    .click();
  const adding = page.getByRole("form", {
    name: "New schedule item",
    exact: true,
  });
  await expect(adding.getByLabel("Schedule item", { exact: true })).toHaveValue(
    "",
  );
  await adding.getByRole("button", { name: /^More: / }).click();
}

export async function inspectScheduleRecovery(page: Page, testInfo: TestInfo) {
  const recovery = page.getByRole("dialog", {
    name: "Resume your draft?",
    exact: true,
  });
  await expect(recovery).toBeVisible();
  await expect(page.getByLabel("Schedule item", { exact: true })).toHaveCount(
    0,
  );
  const resume = recovery.getByRole("button", {
    name: "Resume draft",
    exact: true,
  });
  await expect(resume).toBeFocused();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 568 });
    await expectToken(recovery, "background-color", "surface");
    await expectToken(recovery, "color", "ink");
    await expectToken(recovery.getByRole("heading"), "color", "ink");
    for (const paragraph of await recovery.locator("p").all())
      await expectToken(paragraph, "color", "ink");
    await expectHorizontalReflow(page);
    await expect(resume).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`schedule-recovery-${colorScheme}.png`),
    });
  }
  await resume.click();
  await expect(page.getByLabel("Schedule item", { exact: true })).toHaveValue(
    "Garden arrival",
  );
  await expect(page.getByLabel("Schedule item", { exact: true })).toBeFocused();
  await expectDates(
    page.getByRole("dialog", { name: "Add schedule item", exact: true }),
    "Jul 3, 2030 to Jul 5, 2030",
  );
}
