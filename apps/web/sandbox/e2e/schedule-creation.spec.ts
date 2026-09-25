import { expect, test } from "@playwright/test";
import {
  expectCreatedSchedule,
  prepareScheduleCreation,
} from "../../e2e/helpers/schedule-creation";
import { openEventView } from "../../e2e/helpers/event-view";

const sandboxUrl = new URL(
  "../../../../.livtales/sandbox/livtales.html",
  import.meta.url,
).href;

test("creates a canonical schedule item in a focused offline dialog", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await prepareScheduleCreation(page, testInfo);
  await page
    .getByRole("dialog", { name: "Add schedule item", exact: true })
    .getByLabel("Schedule item")
    .press("ControlOrMeta+Enter");
  await expectCreatedSchedule(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Garden arrival", exact: true }),
  ).toHaveCount(1);
  await page.getByLabel("Preview role").selectOption("viewer");
  await openEventView(page, "Calendar");
  await expect(
    page.getByRole("button", { name: "Add schedule item" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
