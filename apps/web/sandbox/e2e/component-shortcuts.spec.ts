import { expect, test } from "@playwright/test";
import { exerciseComponentShortcuts } from "../../e2e/helpers/component-shortcuts";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("customizes scoped insertion offline and preserves Viewer restrictions", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await exerciseComponentShortcuts(page, testInfo);
  await page.getByLabel("Preview role").selectOption("viewer");
  await expect(
    page.getByRole("button", { name: "Add component", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Pages", exact: true })
    .getByRole("button", { name: "Shortcut plans", exact: true })
    .focus();
  await page.keyboard.press("/");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
