import { expect, type Locator, type Page } from "@playwright/test";

/** Opens a row's menu and chooses one of its entries. */
export async function chooseRowAction(
  page: Page,
  row: Locator,
  label: string,
): Promise<void> {
  await row.getByRole("button", { name: /^Actions for / }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: label, exact: true }).click();
  await expect(menu).toHaveCount(0);
}

/** The row's menu button, which takes focus back when a dialog closes. */
export function rowMenuButton(row: Locator): Locator {
  return row.getByRole("button", { name: /^Actions for / });
}

/**
 * Drags a row by pressing anywhere on it and moving past the threshold,
 * then drops it over the target row's upper half (before it) or lower
 * half (after it). The lifted row leaves the list as a card, and a gap
 * marks where it lands.
 */
export async function dragRow(
  page: Page,
  row: Locator,
  target: Locator,
  place: "before" | "after",
): Promise<void> {
  await row.scrollIntoViewIfNeeded();
  const source = await row.boundingBox();
  if (!source) throw new Error("The row is not visible");
  await page.mouse.move(source.x + 40, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + 40, source.y + source.height / 2 + 12, {
    steps: 4,
  });
  await expect(page.locator(".row-drag-card")).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  const destination = await target.boundingBox();
  if (!destination) throw new Error("The target row is not visible");
  const y =
    place === "before"
      ? destination.y + destination.height * 0.25
      : destination.y + destination.height * 0.8;
  await page.mouse.move(destination.x + 40, y, { steps: 6 });
  const gap = page.locator(".row-gap, .row-gap-row");
  await expect(gap).toHaveCount(1);
  await expect(
    target.locator(
      place === "before"
        ? "xpath=preceding-sibling::*[1]"
        : "xpath=following-sibling::*[1]",
    ),
  ).toHaveClass(/row-gap/);
  await page.mouse.up();
  await expect(page.locator(".row-drag-card")).toHaveCount(0);
}
