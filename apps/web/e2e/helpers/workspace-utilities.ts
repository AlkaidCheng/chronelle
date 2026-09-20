import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectHorizontalReflow } from "./page-navigation";
import {
  accountBlock,
  moreTrigger,
  openAccountMenu,
  openThemePanel,
  workspaceSwitcher,
} from "./quiet-chrome";
import { openEventView } from "./event-view";

export async function exerciseWorkspaceUtilities(
  page: Page,
  testInfo: TestInfo,
) {
  const navigation = page.getByRole("navigation", {
    name: "Workspace navigation",
  });
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
  // Arranging the rail is a desktop task: a phone's More does not offer it.
  const phone = (page.viewportSize()?.width ?? 1280) <= 760;
  await expect(
    more.getByRole("menuitem", { name: "Customize sidebar", exact: true }),
  ).toHaveCount(phone ? 0 : 1);
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
  // workspace under it. Its menu starts with the account, then the
  // Workspace section (the current one ticked, Switch workspace...),
  // then Friends, Settings, Sign out.
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
  const current = menu.getByRole("menuitemradio", { checked: true });
  await expect(current).toHaveCount(1);
  await expect(current).toContainText("Personal");
  await expect(current).toBeFocused();
  const switchItem = menu.getByRole("menuitem", {
    name: "Switch workspace...",
    exact: true,
  });
  await expect(switchItem).toBeVisible();
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

  // Switch workspace... replaces the menu with the switcher's list; Escape
  // leads back to the menu at that entry, and again to the block.
  await page.keyboard.press("Enter");
  await switchItem.click();
  const switcher = workspaceSwitcher(page);
  await expect(switcher).toBeVisible();
  const listed = switcher.getByRole("menuitemradio", { checked: true });
  await expect(listed).toHaveCount(1);
  await expect(listed).toBeFocused();
  await expect(
    switcher.getByRole("menuitem", { name: "Members", exact: true }),
  ).toHaveAttribute("href", /\/settings\/members$/u);
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

  await page.setViewportSize({ width: 320, height: 568 });
  await openAccountMenu(page);
  await expectHorizontalReflow(page);
  await expect(
    menu.getByRole("menuitem", { name: "Sign out", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("account-menu-narrow.png"),
  });
  await page.keyboard.press("Escape");
  await account.click();
  await switchItem.click();
  await expectHorizontalReflow(page);
  await expect(
    switcher.getByRole("menuitem", { name: "Members", exact: true }),
  ).toBeInViewport();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await openThemePanel(page);
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
  await expect(moreTrigger(page)).toBeFocused();
  await expectHorizontalReflow(page);
  await page.screenshot({
    path: testInfo.outputPath("workspace-navigation-narrow.png"),
  });
}
