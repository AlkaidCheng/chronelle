import { expect, test } from "@playwright/test";
import { exerciseTaskEditors } from "../../e2e/helpers/task-editors";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("creates and edits a canonical Task through focused offline surfaces", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await exerciseTaskEditors(page, testInfo);
  await page.reload();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "Pack garden supplies and chairs" }),
  ).toHaveCount(1);
  await page.getByLabel("Preview role").selectOption("viewer");
  await expect(page.getByRole("button", { name: /^Add a task/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", {
      name: "Complete Pack garden supplies and chairs",
      exact: true,
    }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});
