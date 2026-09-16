import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectHorizontalReflow } from "./page-navigation";

export async function exerciseEventInspector(page: Page, testInfo: TestInfo) {
  await page.getByRole("button", { name: "New event", exact: true }).click();
  await page.getByLabel("Event name", { exact: true }).fill("Garden evening");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  const trigger = page.getByRole("button", { name: "Edit event", exact: true });
  await expect(trigger).toBeVisible();
  const eventUrl = page.url();
  const hero = page.locator(".event-hero");
  const height = await hero.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  const inspector = page.getByRole("dialog", {
    name: "Edit event",
    exact: true,
  });
  await trigger.click();
  const name = inspector.getByLabel("Name", { exact: true });
  await expect(name).toBeFocused();
  expect(
    await inspector.locator("footer").evaluate((footer) => {
      const dialog = footer.closest("dialog");
      return dialog === null
        ? Infinity
        : Math.abs(
            dialog.getBoundingClientRect().bottom -
              footer.getBoundingClientRect().bottom,
          );
    }),
  ).toBeLessThanOrEqual(2);
  await page.screenshot({ path: testInfo.outputPath("inspector-open.png") });
  expect(await inspector.evaluate((element) => element.matches(":modal"))).toBe(
    true,
  );
  expect(
    await hero.evaluate((element) => element.getBoundingClientRect().height),
  ).toBe(height);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await name.fill("Changed garden evening");
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("dialog", { name: "Search", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  const confirmation = page.getByRole("dialog", {
    name: "Discard changes?",
    exact: true,
  });
  const keep = confirmation.getByRole("button", {
    name: "Keep editing",
    exact: true,
  });
  await expect(keep).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    confirmation.getByRole("button", { name: "Discard", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("Changed garden evening");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 568 });
    await inspector
      .getByRole("switch", { name: "Set dates", exact: true })
      .check();
    await expect(inspector.getByRole("table").first()).toBeVisible();
    await expect(
      inspector.getByRole("button", { name: "Save event", exact: true }),
    ).toBeInViewport();
    await expect(
      inspector.getByRole("button", { name: "Close event editor" }),
    ).toBeInViewport();
    await expectHorizontalReflow(page);
    expect(
      await inspector.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`inspector-${colorScheme}.png`),
    });
    await inspector
      .getByRole("switch", { name: "Set dates", exact: true })
      .uncheck();
  }
  await inspector.getByRole("button", { name: "Cancel", exact: true }).click();
  await confirmation
    .getByRole("button", { name: "Discard", exact: true })
    .click();
  await expect(trigger).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Garden evening", exact: true }),
  ).toBeVisible();
  expect(page.url()).toBe(eventUrl);
  await trigger.click();
  await expect(name).toHaveValue("Garden evening");
  await name.fill("Saved garden evening");
  await name.press("Control+Enter");
  await expect(inspector).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Saved garden evening", exact: true }),
  ).toBeVisible();
  await expect(trigger).toBeFocused();
  expect(page.url()).toBe(eventUrl);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Saved garden evening", exact: true }),
  ).toBeVisible();
}
