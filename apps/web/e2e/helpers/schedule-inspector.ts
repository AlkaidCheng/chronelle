import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectToken } from "./appearance";
import { expectHorizontalReflow } from "./page-navigation";
import { openEventView } from "./event-view";
import { chip, composer } from "./record-composers";

export async function exerciseScheduleInspector(
  page: Page,
  testInfo: TestInfo,
) {
  await openEventView(page, "Overview");
  await openEventView(page, "Calendar");
  const calendarUrl = page.url();
  const calendar = page
    .locator(".planning-panel")
    .filter({ has: page.getByRole("heading", { name: "Calendar" }) })
    .locator(".resource-list");
  const edit = calendar.getByRole("button", { name: /^Edit / }).first();
  const rowName = (await edit.getAttribute("aria-label"))?.slice(
    "Edit ".length,
  );
  const inspector = composer(page, `Edit ${rowName}`);
  await edit.scrollIntoViewIfNeeded();
  // The row opens in place as the composer, the name focused.
  await edit.click();
  const name = inspector.getByLabel("Schedule item", { exact: true });
  await expect(name).toBeFocused();
  await expect(chip(inspector, /^Dates: /)).toBeVisible();
  await name.fill("Recovered schedule item");
  // Escape closes an untouched composer at once; one with changes asks
  // when another row opens over it. Here the panel is checked, then the
  // draft survives leaving the page.
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 568 });
    await expectToken(inspector, "background-color", "surface");
    await expectToken(name, "color", "ink");
    for (const text of await inspector.locator(".chip.is-set").all())
      await expectToken(text, "color", "ink");
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expectHorizontalReflow(page);
    // The composer sits in the list, so a small screen scrolls to its foot.
    await inspector
      .getByRole("button", { name: "Save", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      inspector.getByRole("button", { name: "Save", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`schedule-inspector-${colorScheme}.png`),
    });
  }
  await page.goBack();
  await expect(inspector).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(calendarUrl);
  // The row left open with a draft opens again, the draft in it.
  await expect(name).toHaveValue("Recovered schedule item");
  await name.press("Enter");
  await expect(inspector).toHaveCount(0);
  await expect(
    calendar.getByRole("button", { name: "Edit Recovered schedule item" }),
  ).toBeFocused();
  await expect(
    calendar.getByRole("heading", { name: "Recovered schedule item" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Layout", exact: false }).click();
  await page
    .getByRole("menuitemradio", { name: "Agenda", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Recovered schedule item",
      exact: true,
    }),
  ).toBeVisible();
  await openEventView(page, "Timeline");
  await expect(
    page.getByRole("heading", {
      name: "Recovered schedule item",
      exact: true,
    }),
  ).toBeVisible();
}
