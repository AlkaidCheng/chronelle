import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectHorizontalReflow } from "./page-navigation";

export async function openWorkspaceSettings(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Workspace settings" });
  if (!(await dialog.isVisible()))
    await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function exerciseWorkspaceUtilities(
  page: Page,
  testInfo: TestInfo,
) {
  const navigation = page.getByRole("navigation", {
    name: "Workspace navigation",
  });
  for (const name of ["Events", "Tasks", "Search", "Trash"])
    await expect(
      navigation.getByRole("link", { name, exact: true }),
    ).toBeVisible();
  const trigger = navigation.getByRole("button", { name: "More", exact: true });
  await expect(trigger).toHaveCount(1);
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Workspace settings" });
  await expect(dialog).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("workspace-settings.png"),
  });
  await expect(
    dialog.getByRole("button", { name: "Close workspace settings" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("combobox", { name: "Workspace", exact: true }),
  ).toBeFocused();
  for (let index = 0; index < 10; index += 1) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate(
        (element) =>
          document.activeElement === document.body ||
          element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await dialog.getByRole("button", { name: "Customize appearance" }).click();
  const appearance = page.getByRole("dialog", {
    name: "Appearance",
    exact: true,
  });
  await expect(appearance).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(appearance).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Customize appearance" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.getByRole("button", { name: "Browse event data" }).click();
  await page.getByRole("tab", { name: "To-dos", exact: true }).click();
  const filter = page.getByRole("button", { name: "all", exact: true });
  await filter.click();
  const eventUrl = page.url();
  await openWorkspaceSettings(page);
  await page.mouse.click(2, 2);
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(filter).toHaveAttribute("aria-pressed", "true");
  expect(page.url()).toBe(eventUrl);

  await page.setViewportSize({ width: 320, height: 568 });
  await openWorkspaceSettings(page);
  await expectHorizontalReflow(page);
  await expect(
    dialog.getByRole("combobox", { name: "Workspace", exact: true }),
  ).toBeInViewport();
  await expect(
    dialog.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("workspace-settings-narrow.png"),
  });
  await dialog.getByRole("radio", { name: "Dark", exact: true }).check();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await page.screenshot({
    path: testInfo.outputPath("workspace-settings-dark.png"),
  });
  await page.setViewportSize({ width: 568, height: 320 });
  await expect(
    dialog.getByRole("button", { name: "Close workspace settings" }),
  ).toBeInViewport();
  await expect(
    dialog.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeInViewport();
  await expectHorizontalReflow(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expectHorizontalReflow(page);
  await page.screenshot({
    path: testInfo.outputPath("workspace-navigation-narrow.png"),
  });
}
