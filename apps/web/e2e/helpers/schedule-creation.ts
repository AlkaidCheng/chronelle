import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectToken } from "./appearance";
import { expectHorizontalReflow } from "./page-navigation";

export async function prepareScheduleCreation(page: Page, testInfo: TestInfo) {
  await page.getByRole("button", { name: "Browse event data" }).click();
  await page.getByRole("tab", { name: "Calendar", exact: true }).click();
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
  await dialog.getByRole("button", { name: "Change year" }).click();
  await dialog.getByLabel("Go to year", { exact: true }).fill("2030");
  await dialog.getByRole("button", { name: "Go", exact: true }).click();
  await dialog.getByRole("button", { name: "Change month" }).click();
  await dialog.getByRole("button", { name: "July", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Jul 3, 2030", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Jul 5, 2030", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
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
  await expect(
    dialog.getByRole("status", { name: "Date range summary" }),
  ).toHaveText("3 days, including start and end dates.");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 568 });
    await expectToken(dialog, "background-color", "surface");
    await expectToken(dialog, "color", "ink");
    await expectToken(dialog.getByRole("heading"), "color", "ink");
    for (const text of await dialog
      .locator(".schedule-toggle strong, .calendar-range-summary strong")
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
  for (const view of ["Itinerary", "Timeline"]) {
    await page.getByRole("tab", { name: view, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Garden arrival", exact: true }),
    ).toHaveCount(1);
  }
}
