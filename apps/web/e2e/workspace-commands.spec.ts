import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import {
  keyboardSection,
  setKeyboardPreferences,
} from "./helpers/keyboard-settings";
import { exerciseWorkspaceCommands } from "./helpers/workspace-commands";
import { moreTrigger, openMoreMenu, searchEntry } from "./helpers/quiet-chrome";

test("protects Task editor focus and navigates without saving discarded fields @webkit-desktop @webkit-mobile", async ({
  page,
  request,
}, testInfo) => {
  const email = `commands-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Event planner" },
  });
  expect(identity.ok()).toBe(true);
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "An afternoon together" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Event planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("link", { name: /An afternoon together/ }).click();
  await exerciseWorkspaceCommands(page, testInfo);
  expect(
    await (await request.get(`/api/events/${event.id}`, { headers })).json(),
  ).toEqual(event);
});

test("persists shortcut opt-out and synchronizes another tab @webkit-desktop @webkit-mobile", async ({
  page,
  context,
}) => {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Keyboard planner");
  await page.getByLabel("Email").fill(`shortcuts-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const trigger = searchEntry(page);
  await setKeyboardPreferences(page, { command: "disabled" });
  await page.reload();
  await trigger.focus();
  await expect(trigger).not.toHaveAttribute("aria-keyshortcuts");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const other = await context.newPage();
  await other.goto("/sign-in/development");
  await other.evaluate(() =>
    localStorage.removeItem("chronelle.command-shortcut"),
  );
  await expect(trigger).toHaveAttribute(
    "aria-keyshortcuts",
    "Control+k Meta+k",
  );
  await trigger.focus();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
  await other.close();
});

test("leads from More to the Keyboard settings, where the Search shortcut is switched @webkit-desktop", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "A touch device offers no keyboard settings.");
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Keyboard planner");
  await page.getByLabel("Email").fill(`more-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
  const more = await openMoreMenu(page);
  await more
    .getByRole("menuitem", { name: "Keyboard shortcuts", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings\/keyboard$/u);
  await expect(more).toHaveCount(0);
  const section = keyboardSection(page);
  const search = section.getByRole("switch", {
    name: "Open Search",
    exact: true,
  });
  await expect(search).toBeChecked();
  await expect(
    section.getByRole("button", { name: "Reset keyboard shortcuts" }),
  ).toBeVisible();
  // The palette itself carries no settings: the field has focus, the keys
  // read under the results, and Escape returns focus to the entry.
  await searchEntry(page).click();
  const palette = page.getByRole("dialog", { name: "Search" });
  await expect(palette).toBeVisible();
  await expect(
    palette.getByRole("combobox", { name: "Search records and commands" }),
  ).toBeFocused();
  await expect(palette.getByText("Keyboard shortcuts")).toHaveCount(0);
  await expect(palette.locator("footer.command-keys")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(searchEntry(page)).toBeFocused();
  await expect(moreTrigger(page)).toBeVisible();
});
