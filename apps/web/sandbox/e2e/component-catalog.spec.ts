import { expect, test } from "@playwright/test";
import { exerciseComponentCatalog } from "../../e2e/helpers/component-catalog";

const sandboxUrl = new URL(
  "../../../../.livtales/sandbox/livtales.html",
  import.meta.url,
).href;

test("uses the same catalog offline and keeps Viewer insertion unavailable", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await exerciseComponentCatalog(page, testInfo);
  await page.getByLabel("Preview role").selectOption("viewer");
  await expect(
    page.getByRole("button", { name: "Add component", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Pages", exact: true })
    .getByRole("button")
    .first()
    .focus();
  await page.keyboard.press("/");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});
