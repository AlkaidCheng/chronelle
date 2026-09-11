import { expect, type Page, type TestInfo } from "@playwright/test";

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
  await editor.getByRole("button", { name: "Change year" }).click();
  const year = editor.getByLabel("Go to year", { exact: true });
  await year.fill("0");
  await year.press("Enter");
  await expect(
    editor.getByRole("button", { name: "Go", exact: true }),
  ).toBeDisabled();
  await expect(year).toBeFocused();
  await year.fill("2099");
  await year.press("Enter");
  await expect(editor.getByRole("grid")).toHaveAttribute("aria-label", /2099$/);
  await expect(
    editor.getByRole("button", { name: "Start date: Choose a day" }),
  ).toBeVisible();
  await editor.getByRole("button", { name: "Change year" }).click();
  await year.fill("2028");
  await editor.getByRole("button", { name: "Go", exact: true }).click();
  await editor.getByRole("button", { name: "Change month" }).click();
  await editor.getByRole("button", { name: "February", exact: true }).click();
  await editor
    .getByRole("button", { name: "Feb 28, 2028", exact: true })
    .click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  const summary = editor.getByRole("status", { name: "Date range summary" });
  await expect(summary).toHaveText("3 days, including start and end dates.");
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 568 });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(summary).toBeInViewport();
    await expect(
      editor.getByRole("button", { name: "Clear end date" }),
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
  await editor.getByRole("button", { name: "Clear end date" }).click();
  const end = editor.getByRole("button", { name: "End date: Optional" });
  await expect(end).toBeFocused();
  await expect(summary).toHaveText("End date optional.");
  await end.click();
  await editor
    .getByRole("button", { name: "Feb 28, 2028", exact: true })
    .click();
  await expect(summary).toHaveText("1 day, including start and end dates.");
  await editor.getByRole("button", { name: "Done", exact: true }).click();
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
