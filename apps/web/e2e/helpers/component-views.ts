import { expect, type Locator, type Page } from "@playwright/test";
import { setDue } from "./due-picker";
import { today } from "./today";

/** Opens a panel's Layout menu and chooses a template by its name. */
export async function chooseLayout(panel: Locator, name: string) {
  await panel.getByRole("button", { name: "Layout" }).click();
  await panel.getByRole("menuitemradio", { name, exact: true }).click();
  await expect(
    panel.getByRole("button", { name: `Layout: ${name}` }),
  ).toBeVisible();
}

/**
 * Adds a To-dos component with two tasks due on one far day and one due
 * today, walks it through the by-day, by-week, and calendar layouts, and
 * checks each chosen layout survives a reload while moving the period
 * does not.
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
  await setDue(editor, "2031-03-05", "09:30");
  await editor
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  // A second task due on the same date, with no time.
  await todos.getByRole("button", { name: "Add task", exact: true }).click();
  await editor.getByLabel("Task", { exact: true }).fill("Send the agenda");
  await setDue(editor, "2031-03-05");
  await editor
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  // A third task due today, which the week and month views open on.
  await todos.getByRole("button", { name: "Add task", exact: true }).click();
  await editor.getByLabel("Task", { exact: true }).fill("Confirm the caterer");
  await setDue(editor, today());
  await editor
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await expect(todos.getByRole("table")).toBeVisible();
  // The list keeps its manual order: each new task after the last.
  await expect(
    todos.getByRole("row", { name: /Send the agenda/ }),
  ).toBeVisible();
  const rows = await todos.getByRole("row").allTextContents();
  expect(rows.findIndex((row) => row.includes("Book the room"))).toBeLessThan(
    rows.findIndex((row) => row.includes("Send the agenda")),
  );

  await expect(
    todos.getByRole("button", { name: "Layout: List", exact: true }),
  ).toBeVisible();
  await chooseLayout(todos, "By day");
  const day = todos.getByRole("region", { name: /Mar 5/ });
  await expect(day).toBeVisible();
  await expect(day.getByRole("listitem")).toHaveCount(2);
  await expect(day.getByRole("listitem").first()).toContainText(
    "Book the room",
  );
  await expect(day.getByRole("listitem").first()).toContainText("9:30 AM");
  await expect(day.getByRole("listitem").last()).toContainText(
    "Send the agenda",
  );
  await expect(day.getByRole("listitem").last()).not.toContainText("AM");
  await expect(todos.getByRole("table")).toHaveCount(0);
  await expect(page.getByText("Shown by day.")).toBeAttached();

  await page.reload();
  const reopened = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "To-dos", exact: true }),
  });
  await expect(reopened.getByRole("region", { name: /Mar 5/ })).toBeVisible();
  await expect(
    reopened.getByRole("button", { name: "Layout: By day", exact: true }),
  ).toBeVisible();

  // The week opens on today; the far tasks are outside it.
  await chooseLayout(reopened, "By week");
  const period = reopened.getByRole("group", { name: "Period", exact: true });
  const todayColumn = reopened.locator(".week-day.is-today");
  await expect(todayColumn).toHaveCount(1);
  await expect(todayColumn.getByText("Confirm the caterer")).toBeVisible();
  await expect(reopened.getByText("Book the room")).toHaveCount(0);
  // Moving the period is not saved; the ring returns to this week.
  await period.getByRole("button", { name: "Next week" }).click();
  await expect(reopened.locator(".week-day.is-today")).toHaveCount(0);
  await expect(reopened.getByText("Confirm the caterer")).toHaveCount(0);
  await period.getByRole("button", { name: "This week" }).click();
  await expect(todayColumn.getByText("Confirm the caterer")).toBeVisible();
  // A column's row completes the task like the list's; every status shown.
  await reopened.getByRole("button", { name: /^Filter/ }).click();
  await reopened
    .getByRole("menuitemradio", { name: "All", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await todayColumn
    .getByRole("button", { name: "Complete Confirm the caterer" })
    .click();
  await expect(
    todayColumn.getByRole("button", { name: "Reopen Confirm the caterer" }),
  ).toBeVisible();

  // The calendar opens on today's month; today's cell holds the row, and
  // the grid ends with the week of the month's last day.
  await chooseLayout(reopened, "Calendar");
  const grid = reopened.getByRole("table");
  await expect(grid).toBeVisible();
  const todayCell = reopened.locator(".month-day.is-today");
  await expect(todayCell.locator(".is-done")).toContainText(
    "Confirm the caterer",
  );
  await expect(
    todayCell.getByRole("button", { name: "Reopen Confirm the caterer" }),
  ).toBeAttached();
  await expect(
    period.getByRole("button", { name: "This month" }),
  ).toBeVisible();
  const cells = await grid.getByRole("cell").count();
  expect(cells % 7).toBe(0);
  expect(cells).toBeLessThanOrEqual(42);
  await expect(
    grid.locator("tr").last().locator(".is-outside"),
  ).not.toHaveCount(7);

  await page.reload();
  await expect(reopened.getByRole("table")).toBeVisible();
  await expect(
    reopened.getByRole("button", { name: "Layout: Calendar", exact: true }),
  ).toBeVisible();
  await reopened.getByRole("button", { name: /^Filter/ }).click();
  await reopened
    .getByRole("menuitemradio", { name: "All", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(reopened.locator(".month-day.is-today")).toContainText(
    "Confirm the caterer",
  );

  // Expenses place a transaction on the day it happened; the month shows
  // the amount in today's cell and the day's total under the grid.
  await page
    .getByRole("button", { name: "Add component", exact: true })
    .click();
  await picker.getByRole("radio", { name: /^Expenses/ }).check();
  await picker
    .getByRole("button", { name: "Add Expenses", exact: true })
    .click();
  await expect(picker).toHaveCount(0);
  const expenses = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "Expenses", exact: true }),
  });
  await expenses
    .getByRole("button", { name: "Add expense", exact: true })
    .click();
  const expenseEditor = page.getByRole("dialog", {
    name: "Add expense",
    exact: true,
  });
  await expenseEditor.getByLabel("Expense", { exact: true }).fill("Napkins");
  await expenseEditor.getByLabel("Amount", { exact: true }).fill("12.50");
  await expenseEditor
    .getByRole("button", { name: "Record expense", exact: true })
    .click();
  await expect(expenseEditor).toHaveCount(0);
  await chooseLayout(expenses, "Calendar");
  await expect(expenses.locator(".month-day.is-today")).toContainText(
    "Napkins",
  );
  await expect(expenses.locator(".month-day.is-today")).toContainText("$12.50");
  return "Book the room";
}
