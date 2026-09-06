import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("compares and restores history while preserving an open draft", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const original = "Workshop plan";
  const revised = "Revised workshop";
  await page.goto("/sign-in");
  await page.getByLabel("Name").fill("Workshop planner");
  await page.getByLabel("Email").fill(`history-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "New event" }).click();
  await page.getByLabel("Event name").fill(original);
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]+$/u);
  await page.getByRole("button", { name: "Edit event" }).click();
  await page.getByLabel("Name", { exact: true }).fill(revised);
  await page.getByRole("button", { name: "Save event" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(revised);
  await page.getByRole("button", { name: "Edit event" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Unsaved local draft");
  await page.getByRole("button", { name: `History for ${revised}` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Workshop planner/).first()).toBeVisible();
  await dialog.getByRole("button", { name: "Compare v1" }).click();
  await expect(
    dialog.getByRole("combobox", { name: "Before", exact: true }),
  ).toHaveValue("1");
  await expect(
    dialog.getByRole("combobox", { name: "After", exact: true }),
  ).toHaveValue("2");
  await expect(dialog.getByText(original, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Preview v1" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Restore version 1" }),
  ).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "Confirm restore" });
  await expect(confirm).toBeDisabled();
  await expect(
    dialog.getByText("Preview based on current version 2."),
  ).toBeVisible();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await dialog.screenshot({ path: testInfo.outputPath("history-preview.png") });
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(
    true,
  );
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate(
        (element) =>
          element.contains(document.activeElement) ||
          document.activeElement === document.body,
      ),
    ).toBe(true);
  }
  await page.getByLabel("Name", { exact: true }).evaluate((element) => {
    (element as HTMLElement).focus();
  });
  await expect(page.getByLabel("Name", { exact: true })).not.toBeFocused();
  await dialog.getByRole("checkbox", { name: /I reviewed/ }).check();
  const restoration = page.waitForResponse(
    (response) =>
      response.url().endsWith("/revisions/1/restore") &&
      response.request().method() === "POST",
  );
  await confirm.click();
  expect((await restoration).status()).toBe(200);
  await expect(
    dialog.getByText("Restored as version 3. Other views have been refreshed."),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: `History for ${original}` }),
  ).toBeFocused();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(original);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Unsaved local draft",
  );
  await expect(
    page.getByRole("button", { name: "Discard draft and load latest" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save event" })).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(original);
  expect(errors).toEqual([]);
});
