import { expect, type Page, type TestInfo } from "@playwright/test";
import { openTrash } from "./quiet-chrome";
import { openEventPage, openEventView } from "./event-view";

export const navigationPageNames = [
  "Preparation and reservations for a summer together",
  "During the journey: places, people, and quiet afternoons",
  "Returning home and keeping the memories",
] as const;

export async function expectHorizontalReflow(page: Page) {
  const { viewport, documentWidth } = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  const overflowing =
    documentWidth > viewport
      ? await page.evaluate(() =>
          Array.from(document.querySelectorAll("body *"))
            .flatMap((element) => {
              const bounds = element.getBoundingClientRect();
              if (!bounds.width || !bounds.height) return [];
              if (
                bounds.right <= document.documentElement.clientWidth &&
                bounds.left >= 0 &&
                element.scrollWidth <= element.clientWidth
              )
                return [];
              const style = getComputedStyle(element);
              return [
                {
                  tag: element.tagName,
                  class: element.getAttribute("class"),
                  left: bounds.left,
                  right: bounds.right,
                  clientWidth: element.clientWidth,
                  scrollWidth: element.scrollWidth,
                  overflowX: style.overflowX,
                  minWidth: style.minWidth,
                },
              ];
            })
            .slice(0, 30),
        )
      : [];
  expect(
    documentWidth,
    `Horizontal reflow: ${JSON.stringify({ viewport, documentWidth, overflowing })}`,
  ).toBeLessThanOrEqual(viewport);
}

export async function exercisePageNavigation(page: Page, testInfo: TestInfo) {
  const pages = page.getByRole("navigation", { name: "Pages", exact: true });
  const pageButton = (name: string) =>
    pages.getByRole("button", { name, exact: true });
  await openEventPage(page, navigationPageNames[2]);
  await expect(
    page.getByRole("heading", { name: navigationPageNames[2], exact: true }),
  ).toBeVisible();
  const bookmark = page.url();
  await openEventPage(page, navigationPageNames[1]);
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
  await openTrash(page);
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: navigationPageNames[2], exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Unsaved event draft");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: navigationPageNames[2], exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Unsaved event draft",
  );
  await page
    .getByRole("button", { name: "Close event editor", exact: true })
    .click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await openEventView(page, "To-dos");
  await openEventPage(page, navigationPageNames[2]);
  await expect(
    page.getByRole("heading", { name: navigationPageNames[2], exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("named-page-navigation.png"),
    fullPage: true,
  });
  await expectHorizontalReflow(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await expect
    .poll(() =>
      pages.evaluate((strip) => {
        const current = strip.querySelector('[aria-current="page"]');
        if (!current) return false;
        const outer = strip.getBoundingClientRect();
        const inner = current.getBoundingClientRect();
        return inner.left >= outer.left - 1 && inner.right <= outer.right + 1;
      }),
    )
    .toBe(true);
  await expectHorizontalReflow(page);
  await pageButton(navigationPageNames[2]).focus();
  await expect(pageButton(navigationPageNames[2])).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath("named-page-navigation-narrow.png"),
  });
}
