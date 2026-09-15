import { expect, test } from "@playwright/test";
import { exerciseComponentViews } from "../../e2e/helpers/component-views";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("keeps a chosen component view offline", async ({ page, context }) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await exerciseComponentViews(page);
  expect(errors).toEqual([]);
});
