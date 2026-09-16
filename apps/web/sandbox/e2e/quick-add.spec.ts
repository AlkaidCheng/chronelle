import { expect, test } from "@playwright/test";
import {
  exerciseQuickAddInEvent,
  exerciseQuickAddOnTasksPage,
} from "../../e2e/helpers/quick-add";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("adds tasks and reminders from the quick rows offline", async ({
  page,
  context,
}) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await exerciseQuickAddInEvent(page);
  await exerciseQuickAddOnTasksPage(page);
  expect(errors).toEqual([]);
});
