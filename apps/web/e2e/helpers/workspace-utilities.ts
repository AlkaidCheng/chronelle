import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectHorizontalReflow } from "./page-navigation";
import { openAccountMenu, openThemePanel } from "./quiet-chrome";

export async function exerciseWorkspaceUtilities(
  page: Page,
  testInfo: TestInfo,
) {
  const navigation = page.getByRole("navigation", {
    name: "Workspace navigation",
  });
  for (const name of ["Events", "Tasks", "People", "Trash"])
    await expect(
      navigation.getByRole("link", { name, exact: true }),
    ).toBeVisible();
  await expect(
    navigation.getByRole("button", {
      name: "Search and commands",
      exact: true,
    }),
  ).toBeVisible();
  const account = page.locator(".account-trigger");
  await expect(account).toHaveCount(1);
  await account.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Account", exact: true });
  await expect(menu).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("account-menu.png"),
  });
  await expect(menu.getByRole("menuitemradio").first()).toBeFocused();
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

  const theme = await openThemePanel(page);
  await expect(
    theme.getByRole("group", { name: "Appearance" }).getByRole("radio", {
      name: "System",
      exact: true,
    }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(theme).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Theme", exact: true }),
  ).toBeFocused();

  await page.getByRole("tab", { name: "To-dos", exact: true }).click();
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
  await expect(
    page.getByRole("button", { name: "Theme", exact: true }),
  ).toBeFocused();
  await expectHorizontalReflow(page);
  await page.screenshot({
    path: testInfo.outputPath("workspace-navigation-narrow.png"),
  });
}
