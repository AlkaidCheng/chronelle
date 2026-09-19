import { expect, test } from "@playwright/test";
import { expectTimes } from "../../e2e/helpers/date-rows";
import { exerciseScheduleRefinement } from "../../e2e/helpers/schedule-refinement";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("refines schedules offline with explicit times and retained dates", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await exerciseScheduleRefinement(page, testInfo);
  await page.reload();
  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  await expectTimes(
    page.getByRole("dialog", { name: "Edit event", exact: true }),
    "10:00 AM to 11:00 AM",
  );
  expect(errors).toEqual([]);
});
