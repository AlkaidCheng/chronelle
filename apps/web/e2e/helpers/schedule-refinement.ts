import { expect, type Page, type TestInfo } from "@playwright/test";
import { datesSummary, dayName, expectDates } from "./range-picker";

export async function exerciseScheduleRefinement(
  page: Page,
  testInfo: TestInfo,
) {
  await page.getByRole("button", { name: "New event", exact: true }).click();
  const editor = page.getByRole("dialog", {
    name: "Create an event",
    exact: true,
  });
  await editor
    .getByLabel("Event name", { exact: true })
    .fill("Leap-day gathering");
  await editor.getByRole("switch", { name: "Set dates" }).check();
  // The chooser refuses text it cannot read and moves the list to a typed month.
  await editor
    .getByRole("button", { name: /^Choose a month and year/ })
    .click();
  const month = editor.getByLabel("Month and year", { exact: true });
  await month.fill("Octember 2099");
  await expect(month).toHaveAttribute("aria-invalid", "true");
  await month.fill("July 2099");
  await expect(
    editor.getByRole("table", { name: "July 2099" }),
  ).toBeInViewport();
  await expectDates(editor, "not set");
  await month.fill("February 2028");
  await month.press("Enter");
  await editor.getByRole("button", { name: dayName("2028-02-28") }).click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  const summary = datesSummary(editor);
  await expectDates(editor, "Feb 28, 2028 to Mar 1, 2028");
  // Closed, the control reads the range above the times switch.
  await summary.click();
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 568 });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(summary).toBeInViewport();
    await expect(
      editor.getByRole("switch", { name: "Add times" }),
    ).toBeInViewport();
    expect(
      await editor.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`schedule-${colorScheme}.png`),
    });
  }
  if (viewport) await page.setViewportSize(viewport);
  // Clearing the End field leaves the start alone; a click on the start day
  // keeps a one-day range.
  await summary.click();
  await editor.getByLabel("End date", { exact: true }).fill("");
  await expectDates(editor, "Feb 28, 2028");
  await editor.getByRole("button", { name: dayName("2028-02-28") }).click();
  await expectDates(editor, "Feb 28, 2028");
  await summary.click();
  await editor.getByRole("switch", { name: "Add times" }).check();
  const startTime = editor.getByLabel("Start time", { exact: true });
  const endTime = editor.getByLabel("End time (optional)", { exact: true });
  await expect(startTime).toHaveValue("");
  await expect(endTime).toHaveValue("");
  const save = editor.getByRole("button", {
    name: "Create event",
    exact: true,
  });
  await save.click();
  await expect(startTime).toBeFocused();
  await startTime.fill("10:00");
  await endTime.fill("09:00");
  await save.click();
  await expect(editor.getByRole("alert")).toHaveText(
    "End time must not precede start time.",
  );
  await endTime.fill("11:00");
  await editor.getByRole("switch", { name: "Add times" }).uncheck();
  await editor.getByRole("switch", { name: "Add times" }).check();
  await expect(startTime).toHaveValue("10:00");
  await expect(endTime).toHaveValue("11:00");
  await save.click();
  await expect(
    page.getByRole("heading", { name: "Leap-day gathering", exact: true }),
  ).toBeVisible();
}
