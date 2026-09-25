import { expect, test } from "@playwright/test";
import { choosePageOption } from "../../e2e/helpers/quiet-chrome";

const sandboxUrl = new URL(
  "../../../../.livtales/sandbox/livtales.html",
  import.meta.url,
).href;

test("recovers an offline layout across reloads and previews read-only history", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  await page.getByLabel("Page name").fill("Preparation");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add page", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add component", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add To-dos", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Confirm the garden venue", { exact: true }),
  ).toBeVisible();
  await choosePageOption(page, "Page options");
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Remove page", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Remove from layout", exact: true })
    .click();
  await expect(dialog.getByText("No pages in this layout")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Undo layout change", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Remove To-dos from Preparation" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Redo layout change", exact: true }),
  ).toBeEnabled();
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(
    true,
  );
  await page.keyboard.press("Tab");
  expect(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("layout-page-options.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await choosePageOption(page, "Page options");
  await expect(
    dialog.getByRole("button", { name: "Undo layout change", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Layout history", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Version 4 (current)" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Preview version 2", exact: true })
    .click();
  await expect(dialog).toContainText("Preparation: To-dos");
  await dialog
    .getByRole("button", { name: "Restore layout", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Version 5 (current)" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByText("Confirm the garden venue", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Preview role").selectOption("viewer");
  await choosePageOption(page, "Layout history");
  await dialog
    .getByRole("button", { name: "Preview version 2", exact: true })
    .click();
  await expect(dialog).toContainText("Preparation: To-dos");
  await expect(
    dialog.getByRole("button", { name: "Restore layout", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
