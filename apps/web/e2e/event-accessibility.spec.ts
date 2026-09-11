import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { selectLeapDayRange } from "./helpers/calendar-keyboard";

test("keeps date navigation and dialog return focus usable across browser engines", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sign-in");
  await page.getByLabel("Name", { exact: true }).fill("Event planner");
  await page.getByLabel("Email").fill(`keyboard-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const trigger = page.getByRole("button", { name: "New event", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Create an event" });
  await expect(dialog.getByLabel("Event name", { exact: true })).toBeFocused();
  await dialog.getByLabel("Event name", { exact: true }).fill("Winter break");
  await selectLeapDayRange(page);
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(
    true,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("keyboard-schedule.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(dialog.getByLabel("Event name", { exact: true })).toHaveValue(
    "",
  );
  await trigger.evaluate((element) => element.setAttribute("disabled", ""));
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#workspace-content")).toBeFocused();
  expect(errors).toEqual([]);
});
