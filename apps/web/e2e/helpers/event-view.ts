import { expect, type Page } from "@playwright/test";

const foldChip = (page: Page) =>
  page.getByRole("button", { name: /more tabs?$/ });

/** Picks a tab folded away at the strip's end from the chip that lists them. */
async function pickFoldedTab(page: Page, name: string): Promise<boolean> {
  const chip = foldChip(page);
  if (!(await chip.isVisible())) return false;
  await chip.click();
  const menu = page.getByRole("menu", { name: /more tabs?$/ });
  await expect(menu).toBeVisible();
  const item = menu.getByRole("menuitem", { name, exact: true });
  if (await item.isVisible()) {
    await item.click();
    return true;
  }
  await page.keyboard.press("Escape");
  return false;
}

/**
 * Opens one of the event's views: through its tab when the strip shows it,
 * else from the chip that lists the tabs folded away when the width runs
 * out, else through the phone's view select.
 */
export async function openEventView(page: Page, name: string): Promise<void> {
  const tab = page.getByRole("tab", { name, exact: true });
  const select = page.locator(".mobile-view-select select");
  await expect
    .poll(
      async () =>
        (await tab.isVisible()) ||
        (await foldChip(page).isVisible()) ||
        (await select.isVisible()),
    )
    .toBe(true);
  if (await tab.isVisible()) await tab.click();
  else if (!(await pickFoldedTab(page, name)))
    await select.selectOption({ label: name });
  // The chosen view's tab is current, and a current tab never folds.
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** Opens one of the event's pages: through its tab, else from the fold chip. */
export async function openEventPage(page: Page, name: string): Promise<void> {
  const tab = page
    .getByRole("navigation", { name: "Pages", exact: true })
    .getByRole("button", { name, exact: true });
  await expect
    .poll(
      async () => (await tab.isVisible()) || (await foldChip(page).isVisible()),
    )
    .toBe(true);
  if (await tab.isVisible()) await tab.click();
  else await pickFoldedTab(page, name);
  await expect(tab).toHaveAttribute("aria-current", "page");
}
