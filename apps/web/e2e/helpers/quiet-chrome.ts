import { expect, type Page } from "@playwright/test";

/** The sidebar's Search entry, which opens the one palette. */
export const searchEntry = (page: Page) =>
  page.getByRole("button", { name: "Search and commands", exact: true });

export const searchPalette = (page: Page) =>
  page.getByRole("dialog", { name: "Search", exact: true });

/** The active page's options control in the event strip. */
export const pageOptions = (page: Page) =>
  page.getByRole("button", { name: /^Options for / });

export async function choosePageOption(page: Page, name: string) {
  await pageOptions(page).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

/** Opens the page options with the keyboard and activates the named entry. */
export async function choosePageOptionWithKeyboard(page: Page, name: string) {
  const trigger = pageOptions(page);
  await trigger.focus();
  await page.keyboard.press("Enter");
  const item = page.getByRole("menuitem", { name, exact: true });
  for (let index = 0; index < 6; index += 1) {
    if (await item.evaluate((element) => element === document.activeElement))
      break;
    await page.keyboard.press("ArrowDown");
  }
  await expect(item).toBeFocused();
  await page.keyboard.press("Enter");
}

export async function openAccountMenu(page: Page) {
  const menu = page.getByRole("menu", { name: "Account", exact: true });
  if (!(await menu.isVisible())) await page.locator(".account-trigger").click();
  await expect(menu).toBeVisible();
  return menu;
}

/** The rail's foot: the account's name with the current workspace under it, which opens the account menu. */
export const accountBlock = (page: Page) => page.locator(".account-trigger");

export const workspaceSwitcher = (page: Page) =>
  page.getByRole("menu", { name: "Switch workspace", exact: true });

/** Opens the switcher's list through the account menu's Switch workspace... entry. */
export async function openWorkspaceSwitcher(page: Page) {
  const menu = workspaceSwitcher(page);
  if (!(await menu.isVisible())) {
    const account = await openAccountMenu(page);
    await account
      .getByRole("menuitem", { name: "Switch workspace...", exact: true })
      .click();
  }
  await expect(menu).toBeVisible();
  return menu;
}

/** The More control beside the profile block: Trash, Theme, Customize sidebar, Keyboard shortcuts, Help. */
export const moreTrigger = (page: Page) => page.locator(".more-trigger");

export async function openMoreMenu(page: Page) {
  const menu = page.getByRole("menu", { name: "More", exact: true });
  if (!(await menu.isVisible())) await moreTrigger(page).click();
  await expect(menu).toBeVisible();
  return menu;
}

export async function openThemePanel(page: Page) {
  const panel = page.getByRole("dialog", { name: "Theme", exact: true });
  if (!(await panel.isVisible())) {
    const menu = await openMoreMenu(page);
    await menu.getByRole("menuitem", { name: "Theme", exact: true }).click();
  }
  await expect(panel).toBeVisible();
  return panel;
}

/** Reaches the Trash page through More. */
export async function openTrash(page: Page) {
  const menu = await openMoreMenu(page);
  await menu.getByRole("menuitem", { name: "Trash", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Trash", exact: true }),
  ).toBeVisible();
}

async function chooseFromMenu(page: Page, control: string, item: string) {
  await page.getByRole("button", { name: control, exact: true }).click();
  await page.getByRole("menuitemradio", { name: item, exact: true }).click();
}

export const chooseEventSort = (page: Page, label: string) =>
  chooseFromMenu(page, "Sort events", label);
export const chooseEventFilter = (page: Page, label: string) =>
  chooseFromMenu(page, "Filter events", label);
export const chooseEventLayout = (page: Page, label: "Grid" | "List") =>
  chooseFromMenu(page, "Event layout", label);

/**
 * The switcher's entry for a workspace by its title: "Personal" for the
 * account's own, the owner's name for one shared with it. The title leads
 * the accessible name; the role and recency follow.
 */
export const workspaceEntry = (page: Page, title: string) =>
  workspaceSwitcher(page).getByRole("menuitemradio", {
    name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  });

/** Switches to the workspace with the given title from the switcher. */
export async function switchWorkspace(page: Page, title: string) {
  const menu = await openWorkspaceSwitcher(page);
  await workspaceEntry(page, title).click();
  await expect(menu).toHaveCount(0);
}

export async function signOutFromMenu(page: Page) {
  const menu = await openAccountMenu(page);
  await menu.getByRole("menuitem", { name: "Sign out", exact: true }).click();
}

/** Reaches the Search page through the palette's navigation entry. */
export async function openSearchPage(page: Page) {
  await searchEntry(page).click();
  await searchPalette(page)
    .getByRole("option", { name: /^Search / })
    .click();
  await expect(
    page.getByRole("heading", { name: "Search", exact: true }),
  ).toBeVisible();
}
