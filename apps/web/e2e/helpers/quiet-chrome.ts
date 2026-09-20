import { expect, type Page } from "@playwright/test";

/** The sidebar's Search entry, which opens the one palette. */
export const searchEntry = (page: Page) =>
  page.getByRole("button", { name: "Search and commands", exact: true });

/** Whether the page is laid out for a phone: the app bar in place of the rail. */
export const isPhone = (page: Page) =>
  (page.viewportSize()?.width ?? 1280) <= 760;

/** The phone's app bar control that opens the sidebar as a drawer (by class: the journeys change language). */
export const menuControl = (page: Page) => page.locator(".phone-menu");

/** The sidebar as the phone's drawer; absent on a wider viewport. */
export const drawer = (page: Page) => page.locator("dialog.phone-drawer");

/**
 * The sidebar's navigation (Search and the collections), by its name in
 * the page's language. A phone keeps it in the drawer, which opens here
 * when it is not already open.
 */
export async function workspaceNavigation(
  page: Page,
  name = "Workspace navigation",
) {
  const navigation = page.getByRole("navigation", { name });
  // Retried: a viewport just narrowed swaps the rail for the app bar
  // between the look and the press.
  await expect(async () => {
    if (await navigation.isVisible()) return;
    await menuControl(page).click({ timeout: 1000 });
    await expect(navigation).toBeVisible({ timeout: 1000 });
  }).toPass();
  return navigation;
}

/** Closes the phone's drawer when it is open; nothing to do on a wider viewport. */
export async function closeDrawer(page: Page) {
  if (await drawer(page).isVisible()) {
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toBeHidden();
  }
}

/** Follows a collection's link in the sidebar; the phone's drawer closes behind it. */
export async function openCollection(page: Page, name: string) {
  const navigation = await workspaceNavigation(page);
  await navigation.getByRole("link", { name, exact: true }).click();
}

/** Opens the palette from the sidebar's Search entry, through the drawer on a phone. */
export async function pressSearchEntry(page: Page) {
  await expect(async () => {
    if (await searchPalette(page).isVisible()) return;
    await workspaceNavigation(page);
    await searchEntry(page).click({ timeout: 2000 });
    await expect(searchPalette(page)).toBeVisible({ timeout: 2000 });
  }).toPass();
}

/** The control focus returns to once the palette closes: the Search entry, or the phone's menu control. */
export const searchReturn = (page: Page) =>
  isPhone(page) ? menuControl(page) : searchEntry(page);

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

/** The rail's foot: the account's name with the current workspace under it, which opens the account menu; the phone's avatar. */
export const accountBlock = (page: Page) => page.locator(".account-trigger");

/** The phone's app bar control that names the current workspace and opens the switcher as a sheet. */
export const workspaceControl = (page: Page) =>
  page.locator(".phone-workspace");

/** The control that names the current workspace: the rail's account block, or the phone's workspace control. */
export const workspaceBlock = (page: Page) =>
  isPhone(page) ? workspaceControl(page) : accountBlock(page);

export const workspaceSwitcher = (page: Page) =>
  page.getByRole("menu", { name: "Switch workspace", exact: true });

/** Opens the switcher's list: the phone's sheet from its workspace control, else through the account menu's Switch workspace... entry. */
export async function openWorkspaceSwitcher(page: Page) {
  const menu = workspaceSwitcher(page);
  if (!(await menu.isVisible())) {
    if (isPhone(page)) await workspaceControl(page).click();
    else {
      const account = await openAccountMenu(page);
      await account
        .getByRole("menuitem", { name: "Switch workspace...", exact: true })
        .click();
    }
  }
  await expect(menu).toBeVisible();
  return menu;
}

/** The rail's More control beside the account block: Trash, Theme, Customize sidebar, Keyboard shortcuts, Help. */
export const moreTrigger = (page: Page) => page.locator(".more-trigger");

/**
 * More's entries: the rail's popover menu, or the group under the
 * account's own entries in the phone's account sheet, which opens from
 * the avatar.
 */
export async function openMoreMenu(page: Page) {
  const menu = isPhone(page)
    ? page.getByRole("group", { name: "More", exact: true })
    : page.getByRole("menu", { name: "More", exact: true });
  if (!(await menu.isVisible())) await moreControl(page).click();
  await expect(menu).toBeVisible();
  return menu;
}

/**
 * The control More's entries open from, and the one focus returns to once
 * they close: the rail's More, or the phone's avatar (its sheet lists them).
 */
export const moreControl = (page: Page) =>
  isPhone(page) ? page.locator(".account-trigger") : moreTrigger(page);

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
  await pressSearchEntry(page);
  await searchPalette(page)
    .getByRole("option", { name: /^Search / })
    .click();
  await expect(
    page.getByRole("heading", { name: "Search", exact: true }),
  ).toBeVisible();
}
