import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectHorizontalReflow } from "./page-navigation";
import {
  accountBlock,
  closeDrawer,
  drawer,
  isPhone,
  menuControl,
  moreTrigger,
  openAccountMenu,
  openThemePanel,
  workspaceNavigation,
  workspaceSwitcher,
} from "./quiet-chrome";
import { openEventView } from "./event-view";

export async function exerciseWorkspaceUtilities(
  page: Page,
  testInfo: TestInfo,
) {
  if (isPhone(page)) {
    await exercisePhoneUtilities(page, testInfo);
    return;
  }
  const navigation = await workspaceNavigation(page);
  for (const name of ["Events", "Tasks", "People"])
    await expect(
      navigation.getByRole("link", { name, exact: true }),
    ).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Trash" })).toHaveCount(0);
  await moreTrigger(page).click();
  const more = page.getByRole("menu", { name: "More", exact: true });
  await expect(
    more.getByRole("menuitem", { name: "Trash", exact: true }),
  ).toHaveAttribute("href", /\/trash$/u);
  await expect(
    more.getByRole("menuitem", { name: "Customize sidebar", exact: true }),
  ).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(more).toHaveCount(0);
  await expect(moreTrigger(page)).toBeFocused();
  await expect(
    navigation.getByRole("button", {
      name: "Search and commands",
      exact: true,
    }),
  ).toBeVisible();
  // The rail's foot is one block: the account's name with the current
  // space and role under it. Its menu starts with the current space as one
  // row that opens the switcher, then Friends, Settings, Sign out.
  const account = accountBlock(page);
  await expect(account).toHaveCount(1);
  await expect(account).toContainText("Personal");
  await account.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Account", exact: true });
  await expect(menu).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("account-menu.png"),
  });
  const switchItem = menu.getByRole("menuitem", {
    name: "Switch space...",
    exact: true,
  });
  await expect(switchItem).toContainText("Personal");
  await expect(switchItem).toBeFocused();
  await expect(menu.getByRole("menuitem", { name: /^Friends/ })).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("End");
  await expect(
    menu.getByRole("menuitem", { name: "Sign out", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(account).toBeFocused();

  // The current space's row replaces the menu with the switcher's list,
  // which opens on its search field; Escape leads back to the menu at that
  // row, and again to the block.
  await page.keyboard.press("Enter");
  await switchItem.click();
  const switcher = workspaceSwitcher(page);
  await expect(switcher).toBeVisible();
  const listed = switcher.getByRole("menuitemradio", { checked: true });
  await expect(listed).toHaveCount(1);
  await expect(
    switcher.getByRole("searchbox", { name: "Find a space" }),
  ).toBeFocused();
  await expect(
    switcher.getByRole("menuitem", { name: "Manage space", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("workspace-switcher.png"),
  });
  await page.keyboard.press("Escape");
  await expect(switcher).toHaveCount(0);
  await expect(switchItem).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(account).toBeFocused();

  const theme = await openThemePanel(page);
  await expect(
    theme.getByRole("group", { name: "Appearance" }).getByRole("radio", {
      name: "System",
      exact: true,
    }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(theme).toHaveCount(0);
  await expect(moreTrigger(page)).toBeFocused();

  await openEventView(page, "To-dos");
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("menuitemradio", { name: "All", exact: true }).click();
  await page.keyboard.press("Escape");
  const filter = page.getByRole("button", {
    name: "Filter: 1 filter",
    exact: true,
  });
  const eventUrl = page.url();
  await openAccountMenu(page);
  await page.mouse.click(2, 2);
  await expect(menu).toHaveCount(0);
  await expect(filter).toHaveClass(/is-active/);
  expect(page.url()).toBe(eventUrl);

  await exerciseNarrowChrome(page, testInfo);
}

/**
 * The phone's chrome: the app bar's menu opens the sidebar as a drawer
 * with the collections; the avatar opens the account sheet, with More's
 * entries as its second group; the space control opens the switcher
 * as a sheet; Theme opens as a sheet from More. A filter on the page
 * survives a sheet opened and dismissed.
 */
async function exercisePhoneUtilities(page: Page, testInfo: TestInfo) {
  const navigation = await workspaceNavigation(page);
  for (const name of ["Events", "Tasks", "People"])
    await expect(
      navigation.getByRole("link", { name, exact: true }),
    ).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Trash" })).toHaveCount(0);
  await expect(
    navigation.getByRole("button", {
      name: "Search and commands",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("drawer.png") });
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toBeHidden();
  await expect(menuControl(page)).toBeFocused();

  // The account sheet: the account's name and email, then Friends,
  // Settings, Sign out, then what More offers; Trash is a link there and
  // Customize sidebar is offered, as the drawer arranges with Done.
  const account = accountBlock(page);
  await expect(account).toHaveCount(1);
  await account.click();
  const menu = page.getByRole("menu", { name: "Account", exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /^Friends/ })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("account-sheet.png") });
  await expect(
    menu.getByRole("menuitem", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Sign out", exact: true }),
  ).toBeVisible();
  const more = menu.getByRole("group", { name: "More", exact: true });
  await expect(
    more.getByRole("menuitem", { name: "Trash", exact: true }),
  ).toHaveAttribute("href", /\/trash$/u);
  await expect(
    more.getByRole("menuitem", { name: "Customize sidebar", exact: true }),
  ).toBeVisible();
  // One menu: End reaches the last of More's entries.
  await page.keyboard.press("End");
  await expect(
    more.getByRole("menuitem", { name: "Help", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(account).toBeFocused();

  // The space control opens the switcher as its own sheet, on its search
  // field, the current space first, Manage space beside the field.
  const control = page.getByRole("button", { name: /^Space: / });
  await expect(control).toContainText("Personal");
  await control.click();
  const switcher = workspaceSwitcher(page);
  await expect(switcher).toBeVisible();
  const listed = switcher.getByRole("menuitemradio", { checked: true });
  await expect(listed).toHaveCount(1);
  await expect(listed).toContainText("Personal");
  await expect(
    switcher.getByRole("searchbox", { name: "Find a space" }),
  ).toBeFocused();
  await expect(
    switcher.getByRole("menuitem", { name: "Manage space", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("workspace-switcher.png"),
  });
  await page.keyboard.press("Escape");
  await expect(switcher).toHaveCount(0);
  await expect(control).toBeFocused();

  const theme = await openThemePanel(page);
  await expect(
    theme.getByRole("group", { name: "Appearance" }).getByRole("radio", {
      name: "System",
      exact: true,
    }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(theme).toHaveCount(0);
  await expect(account).toBeFocused();

  await openEventView(page, "To-dos");
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("menuitemradio", { name: "All", exact: true }).click();
  await page.keyboard.press("Escape");
  const filter = page.getByRole("button", {
    name: "Filter: 1 filter",
    exact: true,
  });
  const eventUrl = page.url();
  await openAccountMenu(page);
  await page.mouse.click(2, 2);
  await expect(menu).toHaveCount(0);
  await expect(filter).toHaveClass(/is-active/);
  expect(page.url()).toBe(eventUrl);
  await closeDrawer(page);

  await exerciseNarrowChrome(page, testInfo);
}

/**
 * The phone chrome at the narrowest width, whichever width the journey
 * began at: the sheets stay within the viewport, nothing reflows
 * sideways, and the theme sheet's foot is reachable in landscape.
 */
async function exerciseNarrowChrome(page: Page, testInfo: TestInfo) {
  await page.setViewportSize({ width: 320, height: 568 });
  const menu = await openAccountMenu(page);
  await expectHorizontalReflow(page);
  await expect(
    menu.getByRole("menuitem", { name: "Sign out", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("account-menu-narrow.png"),
  });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await page.getByRole("button", { name: /^Space: / }).click();
  const switcher = workspaceSwitcher(page);
  await expect(switcher).toBeVisible();
  await expectHorizontalReflow(page);
  await expect(
    switcher.getByRole("menuitem", { name: "Manage space", exact: true }),
  ).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(switcher).toHaveCount(0);
  const theme = await openThemePanel(page);
  await theme
    .getByRole("group", { name: "Appearance" })
    .getByRole("radio", { name: "Dark", exact: true })
    .check();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expectHorizontalReflow(page);
  await page.screenshot({
    path: testInfo.outputPath("theme-panel-dark.png"),
  });
  await page.setViewportSize({ width: 568, height: 320 });
  await theme
    .getByRole("button", { name: "Reset display settings" })
    .scrollIntoViewIfNeeded();
  await expect(
    theme.getByRole("button", { name: "Reset display settings" }),
  ).toBeInViewport();
  await expectHorizontalReflow(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.keyboard.press("Escape");
  await expect(theme).toHaveCount(0);
  await expect(accountBlock(page)).toBeFocused();
  const navigation = await workspaceNavigation(page);
  await expect(
    navigation.getByRole("link", { name: "People", exact: true }),
  ).toBeInViewport();
  await expectHorizontalReflow(page);
  await page.screenshot({
    path: testInfo.outputPath("workspace-navigation-narrow.png"),
  });
  await closeDrawer(page);
}
