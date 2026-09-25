import { expect, test } from "@playwright/test";
import { openEventPage } from "../../e2e/helpers/event-view";

const sandboxUrl = new URL(
  "../../../../.livtales/sandbox/livtales.html",
  import.meta.url,
).href;

test("composes named pages with canonical tasks and preserves the layout offline", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await expect(
    page.getByRole("button", { name: "Add a page", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("empty-event-pages.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Add page", exact: true })
    .scrollIntoViewIfNeeded();
  const bounds = await page.locator(".event-hero").evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { top: box.top + scrollY, width: box.width, height: box.height };
  });
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a page" });
  await expect(dialog.getByLabel("Page name")).toBeFocused();
  expect(
    await page.locator(".event-hero").evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top + scrollY, width: box.width, height: box.height };
    }),
  ).toEqual(bounds);
  await dialog.getByLabel("Page name").fill("Preparation");
  await dialog.getByRole("button", { name: "Add page", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Preparation", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add component", exact: true })
    .click();
  await page.getByRole("button", { name: "Add To-dos", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "To-dos", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Confirm the garden venue", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("event-page-todos.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  await page.getByLabel("Page name").fill("On the day");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add page", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "On the day", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add component", exact: true })
    .click();
  await page.getByRole("button", { name: "Add To-dos", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Complete Confirm the garden venue",
      exact: true,
    })
    .click();
  await openEventPage(page, "Preparation");
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("menuitemradio", { name: "All", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", {
      name: "Reopen Confirm the garden venue",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Preparation", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("menuitemradio", { name: "All", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", {
      name: "Reopen Confirm the garden venue",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Preview role").selectOption("viewer");
  await expect(
    page.getByRole("heading", { name: "Preparation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add page", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
