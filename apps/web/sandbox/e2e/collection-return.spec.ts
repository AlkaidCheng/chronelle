import { test } from "@playwright/test";
import { exerciseCollectionReturn } from "../../e2e/helpers/collection-return";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("returns to the offline collection with browser storage denied", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  await page.addInitScript(() => {
    for (const key of ["localStorage", "sessionStorage"])
      Object.defineProperty(window, key, {
        configurable: true,
        get: () => {
          throw new DOMException("Storage denied", "SecurityError");
        },
      });
  });
  await page.goto(sandboxUrl);
  await exerciseCollectionReturn(page, testInfo, "studio", 1);
});
