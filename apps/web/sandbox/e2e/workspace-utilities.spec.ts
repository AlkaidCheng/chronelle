import { test } from "@playwright/test";
import { exerciseWorkspaceUtilities } from "../../e2e/helpers/workspace-utilities";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("keeps workspace utilities accessible without losing an offline draft", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await exerciseWorkspaceUtilities(page, testInfo);
});
