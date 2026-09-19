import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectToken } from "./appearance";
import { expectHorizontalReflow } from "./page-navigation";
import {
  closeDatePanel,
  datesRow,
  dayName,
  expectDates,
  openDatePanel,
} from "./date-rows";
import { openEventView } from "./event-view";

export async function prepareScheduleCreation(page: Page, testInfo: TestInfo) {
  await openEventView(page, "Overview");
  await openEventView(page, "Calendar");
  const panel = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "Calendar", exact: true }),
  });
  await expect(panel).toBeVisible();
  const before = await panel.boundingBox();
  expect(before).not.toBeNull();
  await page
    .getByRole("button", { name: "Add schedule item", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Add schedule item",
    exact: true,
  });
  const name = dialog.getByLabel("Schedule item", { exact: true });
  await expect(name).toBeFocused();
  expect((await panel.boundingBox())?.height).toBe(before?.height);
  await name.fill("Garden arrival");
  // The chooser brings July 2030 to the top; two clicks choose the span.
  await openDatePanel(dialog, datesRow(dialog));
  await dialog
    .getByRole("button", { name: /^Choose a month and year/ })
    .click();
  await dialog.getByLabel("Month and year", { exact: true }).fill("July 2030");
  await dialog.getByLabel("Month and year", { exact: true }).press("Enter");
  await dialog.getByRole("button", { name: dayName("2030-07-03") }).click();
  await dialog.getByRole("button", { name: dayName("2030-07-05") }).click();
  await expectDates(dialog, "Jul 3, 2030 to Jul 5, 2030");
  await closeDatePanel(dialog);
  await name.press("Escape");
  const confirmation = page.getByRole("dialog", {
    name: "Discard schedule item?",
  });
  await expect(
    confirmation.getByRole("button", { name: "Keep editing" }),
  ).toBeFocused();
  await expect(name).toBeHidden();
  await confirmation.getByRole("button", { name: "Keep editing" }).click();
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("Garden arrival");
  await expectDates(dialog, "Jul 3, 2030 to Jul 5, 2030");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 568 });
    await expectToken(dialog, "background-color", "surface");
    await expectToken(dialog, "color", "ink");
    await expectToken(dialog.getByRole("heading"), "color", "ink");
    for (const text of await dialog
      .locator(".field-row-value:not(.is-unset)")
      .all())
      await expectToken(text, "color", "ink");
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expectHorizontalReflow(page);
    await expect(
      dialog.getByRole("button", { name: "Add to schedule", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`schedule-creation-${colorScheme}.png`),
    });
  }
}

export async function expectCreatedSchedule(page: Page) {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add schedule item", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Garden arrival", exact: true }),
  ).toHaveCount(1);
  // The Calendar's agenda view and the Timeline show the same item once.
  await page.getByRole("button", { name: "Layout", exact: false }).click();
  await page
    .getByRole("menuitemradio", { name: "Agenda", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Garden arrival", exact: true }),
  ).toHaveCount(1);
  await openEventView(page, "Timeline");
  await expect(
    page.getByRole("heading", { name: "Garden arrival", exact: true }),
  ).toHaveCount(1);
}
