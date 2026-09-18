import { expect, test } from "@playwright/test";
import { openEventView } from "../../e2e/helpers/event-view";

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
  await expect(
    page.getByRole("heading", { name: "Empty plan", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Preview role").selectOption("viewer");
  // A viewer's empty component is its title alone, with no way to add.
  for (const [view, title] of [
    ["To-dos", "No tasks yet"],
    ["Calendar", "Nothing scheduled"],
    ["Expenses", "No expenses recorded"],
    ["Reminders", "No reminders"],
  ] as const) {
    await openEventView(page, view);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(page.locator(".editor-form")).toHaveCount(0);
    // The strip's gallery is the one add control a viewer keeps.
    await expect(
      page.getByRole("button", { name: /^Add (?!a view$)/ }),
    ).toHaveCount(0);
  }
  await page.screenshot({
    path: testInfo.outputPath("viewer-empty-state.png"),
    fullPage: true,
  });
  await page.getByLabel("Preview role").selectOption("owner");
  await openEventView(page, "To-dos");
  await page
    .getByRole("button", { name: /^Add a task/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Add task with details", exact: true })
    .click();
  await page.getByLabel("Task", { exact: true }).fill("Check the venue");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add a task to the list", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("row").filter({ hasText: "Check the venue" }),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: /^Add a task/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Add task with details", exact: true })
    .click();
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
