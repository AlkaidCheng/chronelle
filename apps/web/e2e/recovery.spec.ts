import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("recovers canonical objects and independent context links", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sign-in");
  await page.getByLabel("Name").fill("Recovery planner");
  await page.getByLabel("Email").fill(`recovery-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Event name").fill("Recovery workshop");
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]+$/u);
  const eventUrl = page.url();
  await page.getByRole("tab", { name: "To-dos" }).click();
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page.getByLabel("Task", { exact: true }).fill("Reserve room");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/resources") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Add task" }).click();
  const canonical = (await (await created).json()).resource;
  const row = page.getByRole("row").filter({ hasText: "Reserve room" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Actions for Reserve room" }).click();
  let dialog = page.getByRole("dialog");
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(
    true,
  );
  await dialog.getByRole("button", { name: "Remove context link" }).click();
  await expect(
    dialog.getByRole("button", { name: "Confirm removal" }),
  ).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Confirm removal" }).click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Link removed. The canonical object remains available.",
  );
  await page.keyboard.press("Escape");
  await expect(row).not.toBeVisible();
  await page.getByRole("tab", { name: "Removed links" }).click();
  await page.getByRole("button", { name: "Preview link recovery" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Confirm link recovery" }).click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Link recovered. Neither canonical object was changed.",
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("tab", { name: "To-dos" }).click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Actions for Reserve room" }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Confirm move to Trash" }).click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Moved to Trash. No related objects were deleted.",
  );
  await dialog.getByRole("link", { name: "Open Trash" }).click();
  await page.getByLabel("Object type").selectOption("task");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("trash-list.png") });
  await page
    .getByRole("button", { name: "Preview recovery for Reserve room" })
    .click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Confirm recovery" }),
  ).toBeDisabled();
  await expect(
    dialog.getByText("Preview based on deleted version 2."),
  ).toBeVisible();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await dialog.screenshot({ path: testInfo.outputPath("trash-preview.png") });
  await dialog.getByRole("checkbox").check();
  const recovering = page.waitForResponse((response) =>
    response.url().endsWith(`/objects/${canonical.id}/recover`),
  );
  await dialog.getByRole("button", { name: "Confirm recovery" }).click();
  expect(await (await recovering).json()).toMatchObject({
    id: canonical.id,
    version: 3,
    deletedAt: null,
  });
  await expect(dialog.getByRole("status")).toHaveText(
    "Recovered as version 3. Normal views have been refreshed.",
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Preview recovery for Reserve room" }),
  ).not.toBeVisible();
  await page.goto(eventUrl);
  await page.getByRole("tab", { name: "To-dos" }).click();
  await expect(row).toBeVisible();
  await page
    .getByRole("button", { name: "Actions for Recovery workshop" })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Confirm move to Trash" }).click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Moved to Trash. No related objects were deleted.",
  );
  await dialog.getByRole("link", { name: "Open Trash" }).click();
  await page
    .getByRole("button", { name: "Preview recovery for Recovery workshop" })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Confirm recovery" }).click();
  await expect(dialog.getByRole("status")).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.goto(eventUrl);
  await page.getByRole("tab", { name: "To-dos" }).click();
  await expect(row).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
