import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { keyboardSection } from "./helpers/keyboard-settings";
import {
  closeDrawer,
  openMoreMenu,
  pressSearchEntry,
  searchEntry,
  searchReturn,
  workspaceNavigation,
} from "./helpers/quiet-chrome";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Keyboard planner");
  await page.getByLabel("Email").fill(`hints-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
}

test("shows shortcut symbols and the keyboard settings on a keyboard device alone @webkit-desktop @webkit-mobile", async ({
  page,
  isMobile,
}) => {
  await signIn(page);
  const keyboard = await page.evaluate(
    () => window.matchMedia("(hover: hover) and (pointer: fine)").matches,
  );
  expect(keyboard).toBe(!isMobile);
  // The entry is read in the phone's drawer; the badge hides there on touch.
  const entry = searchEntry(page);
  const badge = entry.locator("kbd");
  await workspaceNavigation(page);
  if (keyboard) await expect(badge).toBeVisible();
  else await expect(badge).toBeHidden();
  await closeDrawer(page);
  const more = await openMoreMenu(page);
  const shortcuts = more.getByRole("menuitem", {
    name: "Keyboard shortcuts",
    exact: true,
  });
  if (keyboard) await expect(shortcuts).toBeVisible();
  else await expect(shortcuts).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(more).toHaveCount(0);
  await pressSearchEntry(page);
  const palette = page.getByRole("dialog", { name: "Search", exact: true });
  await expect(
    palette.getByRole("combobox", { name: "Search records and commands" }),
  ).toBeFocused();
  const keys = palette.locator("footer.command-keys");
  if (keyboard) await expect(keys).toBeVisible();
  else await expect(keys).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);

  await page.goto("/settings/keyboard");
  const section = keyboardSection(page);
  if (!keyboard) {
    await expect(
      section.getByText("This page appears on devices with a keyboard."),
    ).toBeVisible();
    await expect(section.getByRole("table")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Keyboard", exact: true }),
    ).toHaveCount(0);
    return;
  }
  await expect(
    page.getByRole("link", { name: "Keyboard", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const search = section.getByRole("switch", {
    name: "Open Search",
    exact: true,
  });
  await expect(search).toBeChecked();
  await search.uncheck();
  await page.goto("/events");
  await workspaceNavigation(page);
  await expect(badge).toHaveCount(0);
  await closeDrawer(page);
  await searchReturn(page).focus();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette).toHaveCount(0);
  await page.goto("/settings/keyboard");
  await expect(search).not.toBeChecked();
  await section
    .getByRole("button", { name: "Reset keyboard shortcuts" })
    .click();
  await expect(search).toBeChecked();
  await page.goto("/events");
  await expect(badge).toBeVisible();
  await entry.focus();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette).toBeVisible();
});
