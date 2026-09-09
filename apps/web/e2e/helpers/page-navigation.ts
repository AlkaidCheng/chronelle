import { expect, type Page, type TestInfo } from "@playwright/test";

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
  await expectHorizontalReflow(page);
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
  await expectHorizontalReflow(page);
  await picker.evaluate((select) => {
    const overflow = document.createElement("span");
    overflow.dataset.overflowProbe = "";
    overflow.setAttribute("aria-hidden", "true");
    overflow.style.cssText = "width: 366px; height: 1px; pointer-events: none";
    select.after(overflow);
  });
  try {
    await expectHorizontalReflow(page);
  } finally {
    await page
      .locator("[data-overflow-probe]")
      .evaluate((probe) => probe.remove());
  }
  await picker.focus();
  await expect(picker).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath("named-page-navigation-narrow.png"),
  });
}
