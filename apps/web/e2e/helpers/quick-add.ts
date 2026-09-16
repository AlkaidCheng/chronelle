import { expect, type Page } from "@playwright/test";
import { setDue } from "./due-picker";
import { today } from "./today";

/**
 * Adds tasks from the quick row at the end of the Tasks page: Enter adds
 * the name and keeps the field open and empty, Escape puts the row back,
 * and leaving the empty field does too. Returns the names added.
 */
export async function exerciseQuickAddOnTasksPage(page: Page) {
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("link", { name: "Tasks", exact: true })
    .click();
  await expect(page).toHaveURL(/\/tasks$/);
  const open = page.getByRole("button", {
    name: "Add a task to the list",
    exact: true,
  });
  await open.click();
  const field = page.getByLabel("New task", { exact: true });
  await expect(field).toBeFocused();
  await field.fill("Pay the deposit");
  await field.press("Enter");
  await expect(
    page.getByRole("row", { name: /Pay the deposit/ }),
  ).toBeVisible();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("");
  await field.fill("Order the cake");
  await field.press("Enter");
  await expect(page.getByRole("row", { name: /Order the cake/ })).toBeVisible();
  await field.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(open).toBeVisible();
  // Leaving the empty field puts the row back as well.
  await open.click();
  await expect(field).toBeFocused();
  await page.getByRole("heading", { name: "Tasks", level: 1 }).click();
  await expect(field).toHaveCount(0);
  await expect(open).toBeVisible();
  return ["Pay the deposit", "Order the cake"];
}

/**
 * Inside an open Event, adds tasks from the quick rows of the To-dos tab
 * (the list, the No due date group, and today's group, which takes the
 * day as the due date) and reminders from the Reminders tab (the list at
 * the next 9:00, a day group at 9:00 that day). Returns what was added.
 */
export async function exerciseQuickAddInEvent(page: Page) {
  await page.getByRole("button", { name: "Browse event data" }).click();
  await page.getByRole("tab", { name: "To-dos", exact: true }).click();
  const todos = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "To-dos", exact: true }),
  });
  // A task due today, so the by-day view has a day group to add to.
  await todos.getByRole("button", { name: "Add task", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add task", exact: true });
  await editor.getByLabel("Task", { exact: true }).fill("Greet the guests");
  await setDue(editor, today());
  await editor
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await todos
    .getByRole("button", { name: "Add a task to the list", exact: true })
    .click();
  const field = todos.getByLabel("New task", { exact: true });
  await expect(field).toBeFocused();
  await field.fill("Set up chairs");
  await field.press("Enter");
  await expect(todos.getByRole("row", { name: /Set up chairs/ })).toBeVisible();
  await expect(field).toHaveValue("");
  await field.press("Escape");
  await expect(field).toHaveCount(0);

  await todos
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "By day" })
    .click();
  const undated = todos.locator("section.day-group").filter({
    has: page.getByRole("heading", { name: "No due date" }),
  });
  await undated
    .getByRole("button", { name: "Add a task with no due date", exact: true })
    .click();
  await field.fill("Sweep the hall");
  await field.press("Enter");
  await expect(undated.getByText("Sweep the hall")).toBeVisible();
  await field.press("Escape");
  const todayGroup = todos.locator("section.day-group-today");
  await todayGroup.getByRole("button", { name: /^Add a task for / }).click();
  await field.fill("Light the candles");
  await field.press("Enter");
  await expect(todayGroup.getByText("Light the candles")).toBeVisible();
  await field.press("Escape");

  await page.getByRole("tab", { name: "Reminders", exact: true }).click();
  const reminders = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "Reminders", exact: true }),
  });
  await reminders
    .getByRole("button", { name: "Add a reminder to the list", exact: true })
    .click();
  const reminderField = reminders.getByLabel("New reminder", { exact: true });
  await expect(reminderField).toBeFocused();
  await reminderField.fill("Ring the bell");
  await reminderField.press("Enter");
  await expect(
    reminders.getByRole("heading", { name: "Ring the bell", exact: true }),
  ).toBeVisible();
  await expect(reminderField).toHaveValue("");
  await reminderField.press("Escape");
  await reminders
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "By day" })
    .click();
  const dayGroup = reminders.locator("section.day-group").first();
  await dayGroup.getByRole("button", { name: /^Add a reminder for / }).click();
  await reminderField.fill("Buy the cake");
  await reminderField.press("Enter");
  await expect(
    dayGroup.getByRole("heading", { name: "Buy the cake", exact: true }),
  ).toBeVisible();
  await reminderField.press("Escape");
  return {
    tasks: {
      dated: "Light the candles",
      undated: ["Set up chairs", "Sweep the hall"],
    },
    reminders: ["Ring the bell", "Buy the cake"],
  };
}
