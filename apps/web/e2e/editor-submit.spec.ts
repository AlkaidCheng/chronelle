import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { exerciseEditorSubmit } from "./helpers/editor-submit";

test("submits validated editors and synchronizes the browser preference", async ({
  page,
  context,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page
    .getByLabel("Email")
    .fill(`editor-submit-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await exerciseEditorSubmit(page, testInfo);
  const other = await context.newPage();
  await other.goto("/sign-in/development");
  const save = page.getByRole("button", { name: "Create task", exact: true });
  await other.evaluate(() =>
    localStorage.setItem("chronelle.editor-shortcut", "disabled"),
  );
  await expect(save).not.toHaveAttribute("aria-keyshortcuts");
  await other.evaluate(() =>
    localStorage.removeItem("chronelle.editor-shortcut"),
  );
  await expect(save).toHaveAttribute(
    "aria-keyshortcuts",
    "Control+Enter Meta+Enter",
  );
  await other.close();
  expect(errors).toEqual([]);
});
