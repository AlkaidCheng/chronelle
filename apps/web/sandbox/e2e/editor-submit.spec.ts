import { expect, test } from "@playwright/test";
import { exerciseEditorSubmit } from "../../e2e/helpers/editor-submit";

const sandboxUrl = new URL(
  "../../../../.livtales/sandbox/livtales.html",
  import.meta.url,
).href;

test("submits editors offline and keeps Viewer projections read-only", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await exerciseEditorSubmit(page, testInfo);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Preview role").selectOption("viewer");
  await expect(page.locator("[data-editor-submit]")).toHaveCount(0);
  await expect(page.getByText("Viewer access", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Complete Keyboard-created task",
      exact: true,
    }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});
