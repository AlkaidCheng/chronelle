import { expect, test } from "@playwright/test";
import { exerciseEventInspector } from "../../e2e/helpers/event-inspector";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("edits an existing Event in a focused offline inspector", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await exerciseEventInspector(page, testInfo);
  expect(errors).toEqual([]);
});
