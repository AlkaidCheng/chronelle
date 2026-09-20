import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { isKeyboardDevice, setKeyboardPreferences } from "./keyboard-settings";
import { expectHorizontalReflow } from "./page-navigation";
import {
  closeDrawer,
  openThemePanel,
  pressSearchEntry,
  searchEntry,
  searchReturn,
  workspaceNavigation,
} from "./quiet-chrome";
import { openTaskEditor } from "./task-add";
import { openEventView } from "./event-view";

export async function exerciseWorkspaceCommands(
  page: Page,
  testInfo: TestInfo,
) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const dialog = page.getByRole("dialog", { name: "Search", exact: true });
  const results = dialog.getByRole("listbox", {
    name: "Commands",
  });
  await openEventView(page, "To-dos");
  await openTaskEditor(page);
  const draft = page.getByLabel("Task", { exact: true });
  await draft.fill("Unsaved command draft");
  await page.keyboard.press("Control+k");
  await expect(dialog).toHaveCount(0);
  await expect(draft).toBeFocused();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(draft).toHaveValue("Unsaved command draft");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add a task to the list", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("menuitemradio", { name: "All", exact: true }).click();
  await page.keyboard.press("Escape");
  const filter = page.getByRole("button", {
    name: "Filter: 1 filter",
    exact: true,
  });
  await searchReturn(page).focus();
  await page.keyboard.press("Control+k");
  const input = dialog.getByRole("combobox", {
    name: "Search records and commands",
  });
  // The key footer and the entry's badge belong to keyboard devices.
  const keyboard = await isKeyboardDevice(page);
  const keys = dialog.locator("footer.command-keys");
  if (keyboard) await expect(keys).toBeVisible();
  else await expect(keys).toBeHidden();
  await expect(input).toBeFocused();
  await expect(
    results.getByRole("group", { name: "Navigation" }).getByRole("option"),
  ).toHaveCount(5);
  const firstCommandId = await results
    .getByRole("option")
    .first()
    .getAttribute("id");
  await page.keyboard.press("ArrowUp");
  await expect(results.getByRole("option", { selected: true })).toContainText(
    "Trash",
  );
  await page.keyboard.press("ArrowDown");
  await expect(results.getByRole("option", { selected: true })).toHaveAttribute(
    "id",
    firstCommandId ?? "",
  );
  await input.fill("nothing matches");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toContainText(
    "No accessible records found",
  );
  await input.fill("");
  await page.screenshot({ path: testInfo.outputPath("commands.png") });
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate(
        (element) =>
          document.activeElement === document.body ||
          element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(searchReturn(page)).toBeFocused();
  await expect(filter).toHaveClass(/is-active/);

  await page.setViewportSize({ width: 320, height: 568 });
  await pressSearchEntry(page);
  await expectHorizontalReflow(page);
  await input.fill("trash");
  await expect(dialog.getByRole("option", { name: /Trash/ })).toBeInViewport();
  await input.fill("");
  await page.screenshot({
    path: testInfo.outputPath("commands-narrow.png"),
  });
  await dialog.getByRole("button", { name: "Close search" }).click();
  await expect(searchReturn(page)).toBeFocused();
  const enable = (section: Locator) =>
    section.getByRole("switch", { name: "Open Search", exact: true });
  await setKeyboardPreferences(page, { command: "disabled" }, async () => {
    await page.screenshot({
      path: testInfo.outputPath("keyboard-settings-narrow.png"),
    });
  });
  await searchReturn(page).focus();
  await page.keyboard.press("Control+k");
  await expect(dialog).toHaveCount(0);
  // The entry's badge: read in the phone's drawer, hidden there on touch.
  const badge = searchEntry(page).locator("kbd");
  await expect(badge).toHaveCount(0);
  await setKeyboardPreferences(
    page,
    { command: "enabled" },
    async (section) => {
      await expect(enable(section)).not.toBeChecked();
    },
  );
  await workspaceNavigation(page);
  if (keyboard) await expect(badge).toBeVisible();
  else await expect(badge).toBeHidden();
  await closeDrawer(page);

  const theme = await openThemePanel(page);
  await theme
    .getByRole("group", { name: "Appearance" })
    .getByRole("radio", { name: "Dark", exact: true })
    .check();
  await page.keyboard.press("Escape");
  await expect(theme).toHaveCount(0);
  await pressSearchEntry(page);
  await expectHorizontalReflow(page);
  await page.screenshot({
    path: testInfo.outputPath("commands-dark-narrow.png"),
  });
  await page.setViewportSize({ width: 568, height: 320 });
  await input.focus();
  await page.keyboard.press("ArrowUp");
  await expect(
    results.getByRole("option", { selected: true }),
  ).toBeInViewport();
  await expect(
    dialog.getByRole("button", { name: "Close search" }),
  ).toBeInViewport();
  await expectHorizontalReflow(page);
  await input.fill("search");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/search$/);
  await expect(dialog).toHaveCount(0);
  await pressSearchEntry(page);
  await dialog.getByRole("option", { name: /Trash/ }).click();
  await expect(page).toHaveURL(/\/trash$/);
  expect(errors).toEqual([]);
}
