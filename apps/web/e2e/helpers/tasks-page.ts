import { expect, type Page } from "@playwright/test";

/**
 * Opens the workspace Tasks page from the rail, creates a task outside any
 * Event, switches to the by-day view, checks the choice survives a reload,
 * and completes the task from the list.
 */
export async function exerciseTasksPage(page: Page) {
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
  await editor
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  const row = page.getByRole("row", { name: /Renew the passport/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("May 20, 2031");

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
  await expect(page.getByText("Renew the passport")).toHaveCount(0);
  await page.getByRole("button", { name: "Completed", exact: true }).click();
  await expect(page.getByText("Renew the passport")).toBeVisible();
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "List" })
    .click();
  return "Renew the passport";
}
