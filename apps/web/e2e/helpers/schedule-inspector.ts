import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectToken } from "./appearance";
import { expectHorizontalReflow } from "./page-navigation";

export async function exerciseScheduleInspector(
  page: Page,
  testInfo: TestInfo,
) {
  await page.getByRole("button", { name: "Browse event data" }).click();
  await page.getByRole("tab", { name: "Calendar", exact: true }).click();
  const calendarUrl = page.url();
  const calendar = page
    .locator(".planning-panel")
    .filter({ has: page.getByRole("heading", { name: "Calendar" }) })
    .locator(".resource-list");
  const edit = calendar
    .getByRole("button", { name: "Edit", exact: true })
    .first();
  const inspector = page.getByRole("dialog", {
    name: "Edit schedule item",
    exact: true,
  });
  await edit.scrollIntoViewIfNeeded();
  const before = await calendar.boundingBox();
  await edit.click();
  const name = inspector.getByLabel("Name", { exact: true });
  await expect(name).toBeFocused();
  expect((await calendar.boundingBox())?.height).toBe(before?.height);
  await name.fill("Recovered schedule item");
  await name.press("Escape");
  const confirmation = page.getByRole("dialog", { name: "Discard changes?" });
  await expect(
    confirmation.getByRole("button", { name: "Keep editing" }),
  ).toBeFocused();
  await expect(name).toBeHidden();
  await confirmation.getByRole("button", { name: "Keep editing" }).click();
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("Recovered schedule item");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 568 });
    await expectToken(inspector, "background-color", "surface");
    await expectToken(inspector, "color", "ink");
    await expectToken(inspector.getByRole("heading"), "color", "ink");
    for (const text of await inspector
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
      inspector.getByRole("button", { name: "Save event", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`schedule-inspector-${colorScheme}.png`),
    });
  }
  await page.goBack();
  await expect(inspector).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(calendarUrl);
  await edit.click();
  const recovery = page.getByRole("dialog", { name: "Resume your draft?" });
  await recovery
    .getByRole("button", { name: "Resume draft", exact: true })
    .click();
  await expect(name).toHaveValue("Recovered schedule item");
  await name.press("ControlOrMeta+Enter");
  await expect(inspector).toHaveCount(0);
  await expect(edit).toBeFocused();
  await expect(
    calendar.getByRole("heading", { name: "Recovered schedule item" }),
  ).toBeVisible();
  for (const view of ["Itinerary", "Timeline"]) {
    await page.getByRole("tab", { name: view, exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Recovered schedule item",
        exact: true,
      }),
    ).toBeVisible();
  }
}
