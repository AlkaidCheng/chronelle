import { expect, type Page } from "@playwright/test";
import { chooseLayout } from "./component-views";
import { setDue } from "./due-picker";
import { chooseRowAction } from "./row-menu";
import { today } from "./today";

/** Opens the Filter menu, chooses one entry, and closes it. */
async function chooseFilter(page: Page, name: string) {
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
  await page.keyboard.press("Escape");
}

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
  await setDue(editor, "2031-05-20");
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
  await chooseRowAction(page, row, "Edit");
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
  await chooseFilter(page, "Paperwork");
  await expect(
    page.getByRole("button", { name: "Filter: 1 filter", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("1 task loaded")).toBeVisible();
  await expect(row).toBeVisible();
  await chooseFilter(page, "Any label");

  // Assign to me creates the signed-in user's person and selects it; the
  // row names the assignee and the Me filter finds the task.
  await chooseRowAction(page, row, "Edit");
  await edit.getByText("Assignee: Unassigned", { exact: true }).click();
  await edit.getByRole("button", { name: "Assign to me", exact: true }).click();
  await expect(
    edit.getByRole("radio", { name: `${member} (me)`, exact: true }),
  ).toBeChecked();
  await expect(edit.getByText(`Assignee: ${member}`)).toBeVisible();
  await edit.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(row.getByText(`Assigned to ${member}`)).toBeAttached();
  await chooseFilter(page, "Me");
  await expect(page.getByText("1 task loaded")).toBeVisible();
  await expect(row).toBeVisible();
  await chooseFilter(page, "Anyone");

  // A subtask nests under its parent and counts toward its progress.
  await chooseRowAction(page, row, "Add subtask");
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
  await subtaskRow.getByRole("button", { name: /^Actions for/ }).click();
  await expect(
    page.getByRole("menu").getByRole("menuitem", { name: "Add subtask" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(row.getByText("0 of 1 subtasks done")).toBeAttached();

  const main = page.getByRole("main");
  await chooseLayout(main, "By day");
  const day = page.getByRole("region", { name: /May 20/ });
  await expect(day).toBeVisible();
  await expect(day.getByText("Renew the passport")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: /May 20/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Layout: By day", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Complete Renew the passport", exact: true })
    .click();
  await expect(
    page.getByText("Renew the passport", { exact: true }),
  ).toHaveCount(0);
  // The open subtask stays, now naming its parent from outside the page.
  await expect(page.getByText("Part of Renew the passport")).toBeVisible();
  await chooseFilter(page, "Done");
  await expect(
    page.getByText("Renew the passport", { exact: true }),
  ).toBeVisible();

  // The week and the calendar ask the server for their days: the 2031
  // task and the undated subtask are outside this week; a task due today
  // lands in its column and in its calendar cell.
  await chooseFilter(page, "All");
  await chooseLayout(main, "By week");
  await expect(page.getByText("0 tasks loaded")).toBeVisible();
  const todayColumn = page.locator(".week-day.is-today");
  await expect(todayColumn).toBeVisible();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await editor.getByLabel("Task", { exact: true }).fill("Water the plants");
  await setDue(editor, today());
  await editor
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await expect(todayColumn.getByText("Water the plants")).toBeVisible();
  await expect(page.getByText("1 task loaded")).toBeVisible();
  await chooseLayout(main, "Calendar");
  await expect(page.locator(".month-day.is-today")).toContainText(
    "Water the plants",
  );
  // Sort is one control too: by name puts the watered plants last.
  await page.getByRole("button", { name: "Sort", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "By name", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Sort: By name", exact: true }),
  ).toBeVisible();
  await chooseLayout(main, "List");
  await expect(
    page.getByRole("row", { name: /Water the plants/ }),
  ).toBeVisible();
  return "Renew the passport";
}
