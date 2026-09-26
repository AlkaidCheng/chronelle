import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { expectHorizontalReflow } from "./helpers/page-navigation";
import {
  accountBlock,
  drawer,
  menuControl,
  searchPalette,
  workspaceControl,
  workspaceEntry,
  workspaceNavigation,
  workspaceSwitcher,
} from "./helpers/quiet-chrome";

/** A finger held on a row past the long press. */
async function longPress(row: Locator) {
  const box = await row.boundingBox();
  if (box === null) throw new Error("The row has no box.");
  const at = { clientX: box.x + 12, clientY: box.y + box.height / 2 };
  const touch = { pointerId: 1, pointerType: "touch", bubbles: true, ...at };
  await row.dispatchEvent("pointerdown", touch);
  await row.page().waitForTimeout(650);
  await row.dispatchEvent("pointerup", touch);
}

/** The vertical middle of an element, in viewport pixels. */
async function middle(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("The element has no box.");
  return box.y + box.height / 2;
}

const signIn = async (page: Page, name: string, email: string) => {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
};

test("gives the phone an app bar whose menu opens the sidebar as a drawer, with the workspace and the account as sheets @webkit-mobile", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.endsWith("mobile"),
    "The app bar is the phone's; a wider viewport keeps the rail.",
  );
  const anaEmail = `ana-${randomUUID()}@example.test`;
  const benEmail = `ben-${randomUUID()}@example.test`;
  const ana = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email: anaEmail, displayName: "Ana Souza" },
    })
  ).json();
  const ben = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email: benEmail, displayName: "Ben Wu" },
    })
  ).json();
  const chen = await (
    await request.post("/api/auth/development/sign-in", {
      data: {
        email: `chen-${randomUUID()}@example.test`,
        displayName: "Chen Li",
      },
    })
  ).json();
  const anaHeaders = { authorization: `Bearer ${ana.accessToken}` };
  const benHeaders = { authorization: `Bearer ${ben.accessToken}` };
  // Ana makes Ben a member of her workspace, so his switcher lists her by
  // name and role; Chen shares one event with him as a viewer, which his
  // own Events list shows.
  const trip = await (
    await request.post("/api/events", {
      headers: { authorization: `Bearer ${chen.accessToken}` },
      data: { displayName: "Kyoto in November" },
    })
  ).json();
  expect(
    (
      await request.post("/api/shares", {
        headers: { authorization: `Bearer ${chen.accessToken}` },
        data: { resourceId: trip.id, principalEmail: benEmail, role: "viewer" },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await request.post("/api/events", {
        headers: anaHeaders,
        data: { displayName: "Ana's plan" },
      })
    ).status(),
  ).toBe(201);
  const sent = await (
    await request.post("/api/friends/invitations", {
      headers: anaHeaders,
      data: { email: benEmail },
    })
  ).json();
  const friend = await (
    await request.post(`/api/friends/requests/${sent.id}/accept`, {
      headers: benHeaders,
    })
  ).json();
  expect(
    (
      await request.post("/api/workspaces/current/members", {
        headers: anaHeaders,
        data: { friendId: friend.id, role: "viewer" },
      })
    ).status(),
  ).toBe(201);

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, "Ben Wu", benEmail);

  // The app bar: the menu control, the workspace as its mark and name (the
  // home mark and "Personal" for the account's own), and the avatar with
  // the account's initials. No bar at the foot: the page's only
  // navigation is the sidebar's, folded into the drawer.
  const bar = page.locator(".phone-bar");
  await expect(bar).toBeVisible();
  await expect(menuControl(page)).toBeVisible();
  await expect(workspaceControl(page)).toContainText("Personal");
  await expect(
    workspaceControl(page).locator(".workspace-mark-home"),
  ).toHaveCount(1);
  await expect(accountBlock(page)).toHaveAccessibleName("Ben Wu");
  await expect(accountBlock(page).locator(".profile-mark")).toHaveText("BW");
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.locator("aside.sidebar")).toHaveCount(0);
  await expectHorizontalReflow(page);
  await page.screenshot({ path: testInfo.outputPath("app-bar.png") });

  // The menu opens the sidebar as a drawer: the brand, Search, and the
  // collections with the open page current. Escape closes it and hands
  // focus back to the menu control.
  await menuControl(page).click();
  await expect(drawer(page)).toBeVisible();
  await expect(
    drawer(page).getByRole("link", { name: "LivTales" }),
  ).toBeVisible();
  const navigation = await workspaceNavigation(page);
  await expect(
    navigation.getByRole("button", { name: "Search and commands" }),
  ).toBeVisible();
  const collections = navigation.getByRole("list", { name: "Collections" });
  await expect(collections.getByRole("link")).toHaveText([
    "Events",
    "Tasks",
    "People",
  ]);
  await expect(
    collections.getByRole("link", { name: "Events", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(drawer(page)).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("drawer.png") });
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toBeHidden();
  await expect(menuControl(page)).toBeFocused();

  // A collection chosen from the drawer opens its page and closes the
  // drawer behind it.
  await menuControl(page).click();
  await collections.getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks$/u);
  await expect(drawer(page)).toBeHidden();
  await expect(
    page.getByRole("heading", { level: 1, name: "Tasks", exact: true }),
  ).toBeVisible();

  // A finger held on a collection enters customization in place: the
  // heading reads "Collections - Done", the rows gain their grips and
  // eyes, and a tap on a row stays put. Done leaves it, the drawer open.
  await menuControl(page).click();
  const people = collections.getByRole("link", { name: "People", exact: true });
  await longPress(people);
  const done = drawer(page).getByRole("button", { name: "Done", exact: true });
  await expect(done).toBeVisible();
  await expect(page.locator(".rail-heading")).toContainText("Collections");
  await expect(
    page.getByRole("button", { name: "Move People", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Hide People", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("drawer-customize.png") });
  await people.click();
  await expect(page).toHaveURL(/\/tasks$/u);
  await expect(drawer(page)).toBeVisible();
  await done.click();
  await expect(done).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Move /u })).toHaveCount(0);
  await expect(drawer(page)).toBeVisible();

  // Search from the drawer closes it and opens the palette over the page;
  // closing the palette returns focus to the menu control.
  await navigation.getByRole("button", { name: "Search and commands" }).click();
  await expect(drawer(page)).toBeHidden();
  await expect(searchPalette(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(searchPalette(page)).toHaveCount(0);
  await expect(menuControl(page)).toBeFocused();

  // The space control opens the switcher as a sheet within the viewport:
  // the account's own first and current, then Ana's by her name and Ben's
  // role, with Manage space beside the search field. Choosing hers switches; the control reads her name
  // with her initials as its mark, and her event is on the list.
  await workspaceControl(page).click();
  const switcher = workspaceSwitcher(page);
  await expect(switcher).toBeVisible();
  await expect(switcher).toBeInViewport();
  await expect(workspaceEntry(page, "Personal")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(workspaceEntry(page, "Ana Souza")).toContainText("Viewer");
  await expect(
    switcher.getByRole("menuitem", { name: "Manage space", exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("workspace-sheet.png") });
  await workspaceEntry(page, "Ana Souza").click();
  await expect(switcher).toHaveCount(0);
  await expect(page).toHaveURL(/\/events$/u);
  await expect(workspaceControl(page)).toContainText("Ana Souza");
  await expect(workspaceControl(page).locator(".workspace-mark")).toHaveText(
    "AS",
  );
  await expect(page.getByRole("link", { name: /Ana's plan/ })).toBeVisible();
  // Cmd/Ctrl+Shift+K opens the sheet from the page and closes it again.
  await page.keyboard.press("ControlOrMeta+Shift+K");
  await expect(switcher).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+K");
  await expect(switcher).toHaveCount(0);
  await workspaceControl(page).click();
  await workspaceEntry(page, "Personal").click();
  await expect(workspaceControl(page)).toContainText("Personal");

  // The avatar opens the account sheet: the account's name and email,
  // Friends, Settings, Sign out, then More's entries under them; no
  // shortcuts entry, as a phone has no keyboard to list them for.
  // Customize sidebar opens the drawer customizing; Theme opens its own
  // sheet, and Escape from it lands back on the avatar.
  await accountBlock(page).click();
  const account = page.getByRole("menu", { name: "Account", exact: true });
  await expect(account).toBeVisible();
  await expect(account).toBeInViewport();
  await expect(page.locator(".sheet-identity")).toContainText("Ben Wu");
  await expect(page.locator(".sheet-identity")).toContainText(benEmail);
  // Safari on an iPhone offers Install app (the home-screen steps) too.
  const ios = await page.evaluate(() =>
    /iPhone|iPad|iPod/.test(navigator.userAgent),
  );
  await expect(account.getByRole("menuitem")).toHaveText([
    /^Friends/,
    "Settings",
    "Sign out",
    "Trash",
    "Theme",
    "Customize sidebar",
    ...(ios ? ["Install app"] : []),
    "Help",
  ]);
  await expect(
    account.getByRole("menuitem", { name: /^Friends/ }),
  ).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("account-sheet.png") });
  await account
    .getByRole("menuitem", { name: "Customize sidebar", exact: true })
    .click();
  await expect(account).toHaveCount(0);
  await expect(drawer(page)).toBeVisible();
  await expect(done).toBeVisible();
  await done.click();
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toBeHidden();
  await accountBlock(page).click();
  await account.getByRole("menuitem", { name: "Theme", exact: true }).click();
  const theme = page.getByRole("dialog", { name: "Theme", exact: true });
  await expect(theme).toBeVisible();
  await expect(theme).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(theme).toHaveCount(0);
  await expect(accountBlock(page)).toBeFocused();

  // The event page's head: the up link and the actions share the first
  // row, the title sits under them, and a share reads as a tag beside
  // the date ("Shared by Chen Li", the role) in place of the line.
  await page.getByRole("link", { name: /Kyoto in November/ }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Kyoto in November" }),
  ).toBeVisible();
  const upLink = page.locator(".event-hero .up-link");
  const actions = page.locator(".event-hero .event-actions");
  expect(
    Math.abs((await middle(upLink)) - (await middle(actions))),
  ).toBeLessThan(4);
  expect(await middle(page.getByRole("heading", { level: 1 }))).toBeGreaterThan(
    await middle(actions),
  );
  const tag = page.locator(".event-access-tag");
  await expect(tag).toBeVisible();
  await expect(tag).toContainText("Shared by Chen Li");
  await expect(tag).toContainText("Viewer");
  await expect(page.locator(".event-hero .access-line")).toBeHidden();
  await expect(page.locator(".mobile-view-select")).toHaveCount(0);
  await expectHorizontalReflow(page);
  await page.screenshot({ path: testInfo.outputPath("event-head.png") });

  // At the narrowest width the bar keeps its three controls in view.
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(menuControl(page)).toBeInViewport();
  await expect(workspaceControl(page)).toBeInViewport();
  await expect(accountBlock(page)).toBeInViewport();
  await expectHorizontalReflow(page);

  // Sign out from the account sheet.
  await accountBlock(page).click();
  await account
    .getByRole("menuitem", { name: "Sign out", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sign-in/u);
  expect(errors).toEqual([]);
});
