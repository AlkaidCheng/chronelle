import { expect, type Page } from "@playwright/test";
import { today } from "./today";

/**
 * Opens the workspace Tasks page from the rail, creates a task outside any
 * Event, labels it, assigns it to the signed-in user (whose person is
 * created on first use and named `member`), switches to the by-day view,
 * checks the choice survives a reload, completes the task from the list,
 * and places a task due today in the week and the month.
 */
export async function exerciseTasksPage(page: Page, member: string) {
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("link", { name: "Tasks", exact: true })
    .click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(
    page.getByRole("heading", { name: "Tasks", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add task", exact: true });
  await editor.getByLabel("Task", { exact: true }).fill("Renew the passport");
  await editor.getByLabel("Due date", { exact: true }).fill("2031-05-20");
  await editor.getByLabel("Location", { exact: true }).fill("Passport office");
  await editor
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  const row = page.getByRole("row", { name: /Renew the passport/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("May 20, 2031");
  await expect(row.getByText("At Passport office")).toBeAttached();
  // Outside any event, the row names none.
  await expect(row.getByRole("link", { name: /^in / })).toHaveCount(0);

  // A label added from the editor is selected at once, shows on the row,
  // and filters the list.
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit task", exact: true });
  await edit.getByText("Labels", { exact: true }).click();
  await edit.getByPlaceholder("New label").fill("Paperwork");
  await edit.getByRole("button", { name: "Add label", exact: true }).click();
  await expect(edit.getByRole("checkbox", { name: "Paperwork" })).toBeChecked();
  await edit.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(
    row.getByRole("list", { name: "Labels" }).getByText("Paperwork"),
  ).toBeVisible();
  await page.getByLabel("Filter by label").selectOption({ label: "Paperwork" });
  await expect(page.getByText("1 task loaded")).toBeVisible();
  await expect(row).toBeVisible();
  await page.getByLabel("Filter by label").selectOption("");

  // Assign to me creates the signed-in user's person and selects it; the
  // row names the assignee and the Me filter finds the task.
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await edit.getByText("Assignee: Unassigned", { exact: true }).click();
  await edit.getByRole("button", { name: "Assign to me", exact: true }).click();
  await expect(
    edit.getByRole("radio", { name: `${member} (me)`, exact: true }),
  ).toBeChecked();
  await expect(edit.getByText(`Assignee: ${member}`)).toBeVisible();
  await edit.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(row.getByText(`Assigned to ${member}`)).toBeAttached();
  await page.getByLabel("Filter by assignee").selectOption({ label: "Me" });
  await expect(page.getByText("1 task loaded")).toBeVisible();
  await expect(row).toBeVisible();
  await page.getByLabel("Filter by assignee").selectOption("");

  // A subtask nests under its parent and counts toward its progress.
  await row
    .getByRole("button", {
      name: "Add subtask to Renew the passport",
      exact: true,
    })
    .click();
  const subtaskEditor = page.getByRole("dialog", {
    name: "Add subtask",
    exact: true,
  });
  await subtaskEditor
    .getByLabel("Task", { exact: true })
    .fill("Find the old passport");
  await subtaskEditor
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(subtaskEditor).toHaveCount(0);
  const subtaskRow = page.getByRole("row", { name: /Find the old passport/ });
  await expect(subtaskRow).toBeVisible();
  await expect(
    subtaskRow.getByRole("button", { name: /^Add subtask/ }),
  ).toHaveCount(0);
  await expect(row.getByText("0 of 1 subtasks done")).toBeAttached();

  const view = page.getByRole("group", { name: "View", exact: true });
  await view.getByRole("button", { name: "By day" }).click();
  const day = page.getByRole("region", { name: /May 20/ });
  await expect(day).toBeVisible();
  await expect(day.getByText("Renew the passport")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: /May 20/ })).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "View", exact: true })
      .getByRole("button", { name: "By day" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Complete Renew the passport", exact: true })
    .click();
  await expect(
    page.getByText("Renew the passport", { exact: true }),
  ).toHaveCount(0);
  // The open subtask stays, now naming its parent from outside the page.
  await expect(page.getByText("Part of Renew the passport")).toBeVisible();
  await page.getByRole("button", { name: "Completed", exact: true }).click();
  await expect(
    page.getByText("Renew the passport", { exact: true }),
  ).toBeVisible();

  // Week and Month ask the server for their days: the 2031 task and the
  // undated subtask are outside this week; a task due today lands in its
  // column and in its month cell.
  await page.getByRole("button", { name: "All tasks", exact: true }).click();
  const views = page.getByRole("group", { name: "View", exact: true });
  await views.getByRole("button", { name: "Week" }).click();
  await expect(page.getByText("0 tasks loaded")).toBeVisible();
  const todayColumn = page.locator(".week-day.is-today");
  await expect(todayColumn).toBeVisible();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await editor.getByLabel("Task", { exact: true }).fill("Water the plants");
  await editor.getByLabel("Due date", { exact: true }).fill(today());
  await editor
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await expect(todayColumn.getByText("Water the plants")).toBeVisible();
  await expect(page.getByText("1 task loaded")).toBeVisible();
  await views.getByRole("button", { name: "Month" }).click();
  await expect(page.locator(".month-day.is-today")).toContainText(
    "Water the plants",
  );
  await views.getByRole("button", { name: "List" }).click();
  await expect(
    page.getByRole("row", { name: /Water the plants/ }),
  ).toBeVisible();
  return "Renew the passport";
}
