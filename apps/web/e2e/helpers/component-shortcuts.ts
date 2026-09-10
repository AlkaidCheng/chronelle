import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectHorizontalReflow } from "./page-navigation";

export async function exerciseComponentShortcuts(
  page: Page,
  testInfo: TestInfo,
) {
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  await page.getByLabel("Page name").fill("Shortcut plans");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add page", exact: true })
    .click();
  const tab = page
    .getByRole("navigation", { name: "Pages", exact: true })
    .getByRole("button", { name: "Shortcut plans", exact: true });
  const add = page.getByRole("button", { name: "Add component", exact: true });
  const picker = page.getByRole("dialog", {
    name: "Add a component",
    exact: true,
  });
  const commands = page.getByRole("dialog", { name: "Commands", exact: true });
  const trigger = page.getByRole("button", { name: "Commands", exact: true });
  await expect(add).toHaveAttribute("aria-keyshortcuts", "/");
  await tab.focus();
  for (const properties of [
    { isComposing: true },
    { keyCode: 229 },
    { repeat: true },
  ]) {
    expect(
      await tab.evaluate(
        (element, extra) =>
          element.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "/",
              bubbles: true,
              cancelable: true,
              ...extra,
            }),
          ),
        properties,
      ),
    ).toBe(true);
    await expect(picker).toHaveCount(0);
  }
  await page.keyboard.press("/");
  await expect(
    picker.getByText("Add to Shortcut plans.", { exact: true }),
  ).toBeVisible();
  const search = picker.getByRole("searchbox", { name: "Find a component" });
  await expect(search).toBeFocused();
  await page.keyboard.type("/files");
  await expect(search).toHaveValue("/files");
  await page.keyboard.press("Control+/");
  await expect(picker).toHaveCount(1);
  await picker.getByRole("button", { name: "Close page dialog" }).click();
  await expect(tab).toBeFocused();

  await trigger.click();
  await commands.getByText("Keyboard shortcuts", { exact: true }).click();
  const preference = commands.getByLabel("Add component shortcut");
  await preference.selectOption("modified-slash");
  await page.setViewportSize({ width: 320, height: 568 });
  await expectHorizontalReflow(page);
  await preference.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("component-shortcuts-narrow.png"),
  });
  await page.keyboard.press("Escape");
  await expect(add).toHaveAttribute("aria-keyshortcuts", "Control+/ Meta+/");
  await tab.focus();
  await page.keyboard.press("/");
  await expect(picker).toHaveCount(0);
  for (const modifier of ["Control", "Meta"]) {
    await tab.focus();
    await page.keyboard.press(`${modifier}+/`);
    await expect(search).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(tab).toBeFocused();
  }
  await page.reload();
  await expect(add).toHaveAttribute("aria-keyshortcuts", "Control+/ Meta+/");
  await tab.focus();
  await page.keyboard.press("Control+/");
  await search.fill("files");
  await picker.getByRole("button", { name: "Add Files", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Files component 1", exact: true }),
  ).toBeVisible();

  await trigger.click();
  await commands.getByText("Keyboard shortcuts", { exact: true }).click();
  await preference.selectOption("disabled");
  await page.keyboard.press("Escape");
  await expect(add).not.toHaveAttribute("aria-keyshortcuts");
  await tab.focus();
  await page.keyboard.press("/");
  await page.keyboard.press("Control+/");
  await expect(picker).toHaveCount(0);
  await add.click();
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(add).toBeFocused();
  await trigger.click();
  await commands.getByText("Keyboard shortcuts", { exact: true }).click();
  await commands
    .getByRole("button", { name: "Reset keyboard shortcuts" })
    .click();
  await expect(preference).toHaveValue("slash");
  await page.keyboard.press("Escape");
  await expect(add).toHaveAttribute("aria-keyshortcuts", "/");
}
