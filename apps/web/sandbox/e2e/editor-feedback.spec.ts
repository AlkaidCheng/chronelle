import { expect, test } from "@playwright/test";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("explains empty Viewer panels and reports saved tasks offline", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await page.getByRole("button", { name: "New event", exact: true }).click();
  await page.getByLabel("Event name", { exact: true }).fill("Empty plan");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await page.getByRole("button", { name: "Browse event data" }).click();
  await page.getByLabel("Preview role").selectOption("viewer");
  for (const view of ["To-dos", "Calendar", "Expenses", "Reminders"]) {
    await page.getByRole("tab", { name: view, exact: true }).click();
    await expect(page.getByText(/This event is read-only/)).toBeVisible();
    await expect(page.locator(".editor-form")).toHaveCount(0);
  }
  await page.screenshot({
    path: testInfo.outputPath("viewer-empty-state.png"),
    fullPage: true,
  });
  await page.getByLabel("Preview role").selectOption("owner");
  await page.getByRole("tab", { name: "To-dos", exact: true }).click();
  const addTask = page.getByRole("button", { name: "Add task", exact: true });
  await addTask.click();
  await page.getByLabel("Task", { exact: true }).fill("Check the venue");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(addTask).toBeFocused();
  await expect(
    page.getByRole("row").filter({ hasText: "Check the venue" }),
  ).toHaveCount(1);
  await addTask.click();
  await expect(page.getByLabel("Task", { exact: true })).toHaveValue("");
  await page.getByLabel("Task", { exact: true }).fill("Check the guest list");
  await expect(page.getByRole("status", { name: "Save status" })).toBeEmpty();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
