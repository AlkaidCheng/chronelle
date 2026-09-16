import { expect, type Locator, type Page } from "@playwright/test";
import { chooseLayout } from "./component-views";
import { chooseRowAction, dragRow, rowMenuButton } from "./row-menu";

/** Opens the Sort menu and chooses an order by its label. */
async function chooseSort(page: Page, name: string) {
  await page.getByRole("button", { name: /^Sort/ }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
}

const names = ["Book the hall", "Order the cake", "Call the band"] as const;

/** The order the given names appear in among a set of rows. */
async function orderOf(rows: Locator, wanted: readonly string[]) {
  const texts = await rows.allTextContents();
  return [...wanted].sort(
    (a, b) =>
      texts.findIndex((text) => text.includes(a)) -
      texts.findIndex((text) => text.includes(b)),
  );
}

/**
 * On an Event's To-dos, adds three tasks, reorders them by dragging and
 * from the row menu, moves one to tomorrow from the Due choices in the
 * by-day view, and, on the Tasks page, drags a row in the table. Every
 * move is one versioned write of the moved task.
 */
export async function exerciseRowOrder(page: Page) {
  await page.getByRole("button", { name: "Browse event data" }).click();
  await page.getByRole("tab", { name: "To-dos", exact: true }).click();
  const panel = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "To-dos", exact: true }),
  });
  await expect(panel).toBeVisible();
  for (const name of names) {
    await panel.getByRole("button", { name: "Add task", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Add task", exact: true });
    await editor.getByLabel("Task", { exact: true }).fill(name);
    await editor
      .getByLabel("Task", { exact: true })
      .press("ControlOrMeta+Enter");
    await expect(editor).toHaveCount(0);
    await expect(
      panel.getByRole("row", { name: new RegExp(name) }),
    ).toBeVisible();
  }
  const rowNames = panel.getByRole("row").locator("td:nth-child(2) strong");
  await expect(rowNames).toHaveText([...names]);

  // A press that moves a few pixels drags; the row lands before another.
  const band = panel.getByRole("row", { name: /Call the band/ });
  await dragRow(
    page,
    band,
    panel.getByRole("row", { name: /Book the hall/ }),
    "before",
  );
  await expect(rowNames).toHaveText([
    "Call the band",
    "Book the hall",
    "Order the cake",
  ]);
  await expect(panel.getByRole("status")).toHaveText("Call the band moved.");

  // The menu opens on request only; Move down is one step, and focus
  // stays on the menu button.
  const hall = panel.getByRole("row", { name: /Book the hall/ });
  await chooseRowAction(page, hall, "Move down");
  await expect(rowNames).toHaveText([
    "Call the band",
    "Order the cake",
    "Book the hall",
  ]);
  await expect(panel.getByRole("status")).toHaveText(
    "Book the hall is now 3 of 3.",
  );
  await expect(rowMenuButton(hall)).toBeFocused();
  await rowMenuButton(hall).press("Enter");
  const menu = page.getByRole("menu", { name: "Actions for Book the hall" });
  await expect(menu.getByRole("menuitem", { name: "Edit" })).toBeFocused();
  await expect(
    menu.getByRole("menuitem", { name: "Move down" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(rowMenuButton(hall)).toBeFocused();

  // By day: Due offers its choices in place; Tomorrow moves the row to
  // that day's group.
  await chooseLayout(panel, "By day");
  const undated = panel.getByRole("region", { name: "No due date" });
  await expect(undated.getByText("Order the cake")).toBeVisible();
  const cake = undated.locator("li").filter({ hasText: "Order the cake" });
  await rowMenuButton(cake).click();
  await page.getByRole("menuitem", { name: "Due", exact: true }).click();
  await expect(
    page.getByRole("menuitemradio", { name: "No date" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: "Tomorrow" }).click();
  const tomorrow = panel.getByRole("region", { name: /Tomorrow/ });
  await expect(tomorrow.getByText("Order the cake")).toBeVisible();
  await expect(panel.getByRole("status")).toHaveText(
    "Order the cake is due tomorrow.",
  );

  // A drop under another day sets that day: the task goes to tomorrow
  // after the row already there.
  const hallRow = undated.locator("li").filter({ hasText: "Book the hall" });
  await dragRow(
    page,
    hallRow,
    tomorrow.locator("li").filter({ hasText: "Order the cake" }),
    "after",
  );
  await expect(tomorrow.locator("li strong")).toHaveText([
    "Order the cake",
    "Book the hall",
  ]);
  await expect(panel.getByRole("status")).toHaveText(
    "Book the hall is due tomorrow.",
  );
  await chooseLayout(panel, "List");

  // The Tasks page lists in the same manual order and drags in its table.
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("link", { name: "Tasks", exact: true })
    .click();
  await expect(page).toHaveURL(/\/tasks$/);
  // Manual is the default order, so the Sort button reads only its name.
  await expect(
    page.getByRole("button", { name: "Sort", exact: true }),
  ).toBeVisible();
  const pageRows = page.getByRole("row");
  await expect(page.getByRole("row", { name: /Book the hall/ })).toBeVisible();
  expect(await orderOf(pageRows, names)).toEqual([
    "Call the band",
    "Order the cake",
    "Book the hall",
  ]);
  await dragRow(
    page,
    page.getByRole("row", { name: /Order the cake/ }),
    page.getByRole("row", { name: /Book the hall/ }),
    "after",
  );
  await expect
    .poll(() => orderOf(pageRows, names))
    .toEqual(["Call the band", "Book the hall", "Order the cake"]);
  // Under another sort the rows do not drag and the steps are not offered.
  await chooseSort(page, "By name");
  await expect(
    page.getByRole("button", { name: "Sort: By name", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => orderOf(pageRows, names))
    .toEqual(["Book the hall", "Call the band", "Order the cake"]);
  await rowMenuButton(page.getByRole("row", { name: /Call the band/ })).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Move up" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await chooseSort(page, "Manual");
}
