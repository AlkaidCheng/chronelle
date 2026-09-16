import { expect, type Page } from "@playwright/test";

/** Today as the calendar date the due date field takes. */
function today(): string {
  const now = new Date();
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Adds a To-dos component with two tasks due on one far day and one due
 * today, walks it through the by-day, week, and month views, and checks
 * each chosen view survives a reload while moving the period does not.
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
  // A third task due today, which the week and month views open on.
  await todos.getByRole("button", { name: "Add task", exact: true }).click();
  await editor.getByLabel("Task", { exact: true }).fill("Confirm the caterer");
  await editor.getByLabel("Due date", { exact: true }).fill(today());
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
  const views = reopened.getByRole("group", { name: "View", exact: true });
  await expect(views.getByRole("button", { name: "By day" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The week opens on today; the far tasks are outside it.
  await views.getByRole("button", { name: "Week" }).click();
  const period = reopened.getByRole("group", { name: "Period", exact: true });
  const todayColumn = reopened.locator(".week-day.is-today");
  await expect(todayColumn).toHaveCount(1);
  await expect(todayColumn.getByText("Confirm the caterer")).toBeVisible();
  await expect(reopened.getByText("Book the room")).toHaveCount(0);
  await expect(views.getByRole("button", { name: "Week" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Moving the period is not saved; Today returns.
  await period.getByRole("button", { name: "Next week" }).click();
  await expect(reopened.locator(".week-day.is-today")).toHaveCount(0);
  await expect(reopened.getByText("Confirm the caterer")).toHaveCount(0);
  await period.getByRole("button", { name: "Today" }).click();
  await expect(todayColumn.getByText("Confirm the caterer")).toBeVisible();
  // A column's row completes the task like the list's; every status shown.
  await reopened.getByRole("button", { name: "all", exact: true }).click();
  await todayColumn
    .getByRole("button", { name: "Complete Confirm the caterer" })
    .click();
  await expect(
    todayColumn.getByRole("button", { name: "Reopen Confirm the caterer" }),
  ).toBeVisible();

  // The month opens on today's day; another day lists what it holds.
  await views.getByRole("button", { name: "Month" }).click();
  const grid = reopened.getByRole("table");
  await expect(grid).toBeVisible();
  const todayCell = reopened.locator(".month-day.is-today");
  await expect(todayCell.locator(".is-done")).toContainText(
    "Confirm the caterer",
  );
  // The selected day's section comes before the undated group.
  const shownDay = reopened.locator(".period-view > .day-group").first();
  await expect(shownDay).toContainText("Confirm the caterer");
  await expect(
    shownDay.getByRole("button", { name: "Reopen Confirm the caterer" }),
  ).toBeVisible();
  // The last cell belongs to the next month and holds nothing.
  await grid.getByRole("button").last().click();
  await expect(shownDay).toContainText("Nothing due this day.");
  await expect(shownDay).not.toContainText("Confirm the caterer");
  await expect(period).toBeVisible();

  await page.reload();
  await expect(reopened.getByRole("table")).toBeVisible();
  await expect(
    reopened
      .getByRole("group", { name: "View", exact: true })
      .getByRole("button", { name: "Month" }),
  ).toHaveAttribute("aria-pressed", "true");
  await reopened.getByRole("button", { name: "all", exact: true }).click();
  await expect(reopened.locator(".month-day.is-today")).toContainText(
    "Confirm the caterer",
  );
  return "Book the room";
}
