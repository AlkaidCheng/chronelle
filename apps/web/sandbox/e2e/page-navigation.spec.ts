import { expect, test } from "@playwright/test";
import {
  exercisePageNavigation,
  navigationPageNames,
} from "../../e2e/helpers/page-navigation";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("preserves named page locations offline", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  for (const name of navigationPageNames) {
    await page.getByRole("button", { name: "Add page", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add a page" });
    await dialog.getByLabel("Page name").fill(name);
    await dialog.getByRole("button", { name: "Add page", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  await exercisePageNavigation(page, testInfo);
});
