import { expect, test } from "@playwright/test";
import { exercisePeoplePage } from "../../e2e/helpers/people-page";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("keeps the offline People page in step with the API", async ({
  page,
  context,
}) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await exercisePeoplePage(page);
  expect(errors).toEqual([]);
});
