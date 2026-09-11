import { expect, test } from "@playwright/test";
import { exercisePagePresets } from "../../e2e/helpers/page-presets";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("previews and recovers page presets offline without exposing Viewer edits", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(60_000);
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await exercisePagePresets(page, testInfo);
  await page.getByLabel("Preview role").selectOption("viewer");
  await expect(
    page.getByRole("button", { name: "Add page", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
