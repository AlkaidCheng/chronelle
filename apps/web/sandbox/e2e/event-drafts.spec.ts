import { expect, test } from "@playwright/test";
import { exerciseEventDrafts } from "../../e2e/helpers/event-drafts";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("protects event drafts offline without saving discarded ideas", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await exerciseEventDrafts(page, testInfo);
  await page.reload();
  await expect(
    page.getByRole("link", { name: /Summer gathering/ }),
  ).toHaveCount(1);
  await expect(page.getByRole("link", { name: /Discarded idea/ })).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
});
