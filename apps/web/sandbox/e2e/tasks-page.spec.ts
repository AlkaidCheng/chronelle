import { expect, test } from "@playwright/test";
import { exerciseTasksPage } from "../../e2e/helpers/tasks-page";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("keeps the offline Tasks page in step with the sample events", async ({
  page,
  context,
}) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await exerciseTasksPage(page, "Sample planner");
  expect(errors).toEqual([]);
});
