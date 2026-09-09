import { expect, type Page, type TestInfo } from "@playwright/test";

export const navigationPageNames = [
  "Preparation and reservations for a summer together",
  "During the journey: places, people, and quiet afternoons",
  "Returning home and keeping the memories",
] as const;

export async function exercisePageNavigation(page: Page, testInfo: TestInfo) {
  const picker = page.getByRole("combobox", { name: "Jump to page" });
  await expect(picker).toBeVisible();
  await picker.selectOption({ label: navigationPageNames[2] });
  await expect(
    page.getByRole("heading", { name: navigationPageNames[2], exact: true }),
  ).toBeVisible();
  const bookmark = page.url();
  await picker.selectOption({ label: navigationPageNames[1] });
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: navigationPageNames[2], exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: navigationPageNames[1], exact: true }),
  ).toBeVisible();
  await page.goto(bookmark);
  await expect(
    page.getByRole("heading", { name: navigationPageNames[2], exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Trash", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Trash", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: navigationPageNames[2], exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Unsaved event draft");
  await page.getByRole("button", { name: "Browse event data" }).click();
  await page.getByRole("button", { name: "Back to pages" }).click();
  await expect(
    page.getByRole("heading", { name: navigationPageNames[2], exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Unsaved event draft",
  );
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("named-page-navigation.png"),
    fullPage: true,
  });
  expect(
    await picker.evaluate((element) => element.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 320, height: 720 });
  await expect
    .poll(() =>
      page
        .getByRole("navigation", { name: "Pages", exact: true })
        .evaluate((strip) => {
          const current = strip.querySelector('[aria-current="page"]');
          if (!current) return false;
          const outer = strip.getBoundingClientRect();
          const inner = current.getBoundingClientRect();
          return inner.left >= outer.left - 1 && inner.right <= outer.right + 1;
        }),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await picker.focus();
  await expect(picker).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath("named-page-navigation-narrow.png"),
  });
}
