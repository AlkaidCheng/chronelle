import { expect, test } from "@playwright/test";
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
  await expect(page.getByLabel("Start time", { exact: true })).toHaveValue(
    "10:00",
  );
  await expect(
    page.getByLabel("End time (optional)", { exact: true }),
  ).toHaveValue("11:00");
  expect(errors).toEqual([]);
});
