import { expect, test } from "@playwright/test";
import { exerciseScheduleInspector } from "../../e2e/helpers/schedule-inspector";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("edits and recovers a canonical schedule item offline", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await exerciseScheduleInspector(page, testInfo);
  expect(errors).toEqual([]);
});
