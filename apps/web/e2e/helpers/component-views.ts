import { expect, type Page } from "@playwright/test";

/**
 * Adds a To-dos component with one dated task, switches it to the by-day
 * view, and checks the choice survives a reload. Returns the Task name.
 */
export async function exerciseComponentViews(page: Page) {
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  const addPage = page.getByRole("dialog", { name: "Add a page" });
  await addPage.getByLabel("Page name").fill("Preparation");
  await addPage.getByRole("button", { name: "Add page", exact: true }).click();
  await expect(addPage).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add component", exact: true })
    .click();
  const picker = page.getByRole("dialog", { name: "Add a component" });
  await picker.getByRole("radio", { name: /^To-dos/ }).check();
  await picker.getByRole("button", { name: "Add To-dos", exact: true }).click();
  await expect(picker).toHaveCount(0);
  const todos = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "To-dos", exact: true }),
  });
  await todos.getByRole("button", { name: "Add task", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add task", exact: true });
  await editor.getByLabel("Task", { exact: true }).fill("Book the room");
  await editor.getByLabel("Due date", { exact: true }).fill("2031-03-05");
  await editor.getByLabel("Due time", { exact: true }).fill("09:30");
  await editor
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  // A second task due on the same date, with no time.
  await todos.getByRole("button", { name: "Add task", exact: true }).click();
  await editor.getByLabel("Task", { exact: true }).fill("Send the agenda");
  await editor.getByLabel("Due date", { exact: true }).fill("2031-03-05");
  await editor
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await expect(todos.getByRole("table")).toBeVisible();
  // The date-only task leads its day in the list.
  await expect(
    todos.getByRole("row", { name: /Send the agenda/ }),
  ).toBeVisible();
  const rows = await todos.getByRole("row").allTextContents();
  expect(rows.findIndex((row) => row.includes("Send the agenda"))).toBeLessThan(
    rows.findIndex((row) => row.includes("Book the room")),
  );

  const view = todos.getByRole("group", { name: "View", exact: true });
  await expect(view.getByRole("button", { name: "List" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await view.getByRole("button", { name: "By day" }).click();
  const day = todos.getByRole("region", { name: /Mar 5/ });
  await expect(day).toBeVisible();
  await expect(day.getByRole("listitem")).toHaveCount(2);
  await expect(day.getByRole("listitem").first()).toContainText(
    "Send the agenda",
  );
  await expect(day.getByRole("listitem").first()).not.toContainText("AM");
  await expect(day.getByText("Book the room")).toBeVisible();
  await expect(day.getByText("9:30 AM")).toBeVisible();
  await expect(todos.getByRole("table")).toHaveCount(0);
  await expect(view.getByRole("button", { name: "By day" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Shown by day.")).toBeAttached();

  await page.reload();
  const reopened = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "To-dos", exact: true }),
  });
  await expect(reopened.getByRole("region", { name: /Mar 5/ })).toBeVisible();
  await expect(
    reopened
      .getByRole("group", { name: "View", exact: true })
      .getByRole("button", { name: "By day" }),
  ).toHaveAttribute("aria-pressed", "true");
  return "Book the room";
}
