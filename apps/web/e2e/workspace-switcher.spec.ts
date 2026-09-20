import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import {
  openWorkspaceSwitcher,
  workspaceEntry,
  workspaceLine,
  workspaceSwitcher,
} from "./helpers/quiet-chrome";

const sharers = [
  "Ana Souza",
  "Ben Wu",
  "Chen Li",
  "Dana Park",
  "Eli Novak",
  "Fay Ito",
  "Kai Tanaka",
];

test("lists the workspaces shared with the account by when they were last opened, kept on the account @webkit-desktop", async ({
  page,
  request,
}) => {
  const email = `switcher-${randomUUID()}@example.test`;
  const readerResponse = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Switcher planner" },
  });
  expect(readerResponse.ok()).toBe(true);
  const reader = await readerResponse.json();
  // Seven people each share an event with the reader: their workspaces
  // become reachable through the shares, and the list passes the six that
  // bring the search field.
  const workspaces: Record<string, string> = {};
  for (const name of sharers) {
    const sharerResponse = await request.post("/api/auth/development/sign-in", {
      data: {
        email: `${name.toLowerCase().replace(" ", ".")}-${randomUUID()}@example.test`,
        displayName: name,
      },
    });
    expect(sharerResponse.ok()).toBe(true);
    const sharer = await sharerResponse.json();
    workspaces[name] = sharer.workspace.displayName;
    const headers = { authorization: `Bearer ${sharer.accessToken}` };
    const created = await request.post("/api/events", {
      headers,
      data: { displayName: `${name}'s plan` },
    });
    expect(created.status()).toBe(201);
    const event = await created.json();
    const shared = await request.post("/api/shares", {
      headers,
      data: { resourceId: event.id, principalEmail: email, role: "viewer" },
    });
    expect(shared.status()).toBe(201);
  }

  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Switcher planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);

  // The switcher: the account's own workspace first and ticked, the shared
  // ones by name while none has been opened, each with its owner's name.
  const line = workspaceLine(page);
  await expect(line).toContainText(reader.workspace.displayName);
  const menu = await openWorkspaceSwitcher(page);
  const search = menu.getByRole("searchbox", { name: "Find a workspace" });
  await expect(search).toBeFocused();
  const entries = menu.getByRole("menuitemradio");
  await expect(entries).toHaveCount(sharers.length + 1);
  await expect(entries.first()).toHaveAttribute("aria-checked", "true");
  await expect(entries.first()).toContainText(reader.workspace.displayName);
  await expect(entries.first()).toContainText("Personal workspace");
  await expect(entries.nth(1)).toContainText(workspaces["Ana Souza"] ?? "");
  await expect(entries.nth(1)).toContainText("Ana Souza");
  await expect(entries.nth(1)).not.toContainText("Opened");
  await expect(
    menu.getByRole("menuitem", { name: "Members", exact: true }),
  ).toHaveAttribute("href", /\/settings\/members$/u);

  // The search narrows by the owner's name; Escape closes and returns focus.
  await search.fill("kai");
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toContainText(workspaces["Kai Tanaka"] ?? "");
  await search.fill("nobody here");
  await expect(entries).toHaveCount(0);
  await expect(menu.getByText("No workspace matches.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(line).toBeFocused();

  // Opening a workspace notes the moment on the account, so it leads the
  // shared list, ticked, with when it was opened. Each switch waits for
  // its note to be kept before the next.
  const switchTo = async (name: string) => {
    const noted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/me") &&
        response.request().method() === "PATCH",
    );
    await openWorkspaceSwitcher(page);
    await workspaceEntry(page, name).click();
    expect((await noted).ok()).toBe(true);
    await expect(line).toContainText(name);
  };
  await switchTo(workspaces["Kai Tanaka"] ?? "");
  await expect(
    page.getByRole("link", { name: /Kai Tanaka's plan/ }),
  ).toBeVisible();
  await openWorkspaceSwitcher(page);
  await expect(entries.nth(1)).toContainText(workspaces["Kai Tanaka"] ?? "");
  await expect(entries.nth(1)).toHaveAttribute("aria-checked", "true");
  await expect(entries.nth(1)).toContainText("Opened");
  await expect(entries.nth(2)).toContainText(workspaces["Ana Souza"] ?? "");
  await page.keyboard.press("Escape");

  // A second switch right after keeps the first note: the most recent
  // leads and the earlier one follows.
  await switchTo(workspaces["Ben Wu"] ?? "");
  await openWorkspaceSwitcher(page);
  await expect(entries.nth(1)).toContainText(workspaces["Ben Wu"] ?? "");
  await expect(entries.nth(1)).toHaveAttribute("aria-checked", "true");
  await expect(entries.nth(2)).toContainText(workspaces["Kai Tanaka"] ?? "");
  await expect(entries.nth(2)).toContainText("Opened");
  await expect(entries.nth(3)).toContainText(workspaces["Ana Souza"] ?? "");
  await page.keyboard.press("Escape");

  // The order is the account's: a fresh session reads it back.
  const session = await (
    await request.get("/api/auth/session", {
      headers: { authorization: `Bearer ${reader.accessToken}` },
    })
  ).json();
  const named = (name: string | undefined) =>
    session.availableWorkspaces.find(
      (workspace: { displayName: string }) => workspace.displayName === name,
    );
  const kai = named(workspaces["Kai Tanaka"]);
  const ben = named(workspaces["Ben Wu"]);
  expect(Object.keys(session.user.workspaceRecency).sort()).toEqual(
    [kai.id, ben.id].sort(),
  );
  expect(kai).toMatchObject({
    personal: false,
    ownerDisplayName: "Kai Tanaka",
    role: null,
  });
  await page.reload();
  await expect(line).toContainText(workspaces["Ben Wu"] ?? "");
  await openWorkspaceSwitcher(page);
  await expect(entries.nth(1)).toContainText(workspaces["Ben Wu"] ?? "");
  await expect(entries.nth(2)).toContainText(workspaces["Kai Tanaka"] ?? "");
  await expect(entries.nth(2)).toContainText("Opened");
  await page.keyboard.press("Escape");

  // The shortcut opens and closes the switcher from the page.
  await page.getByRole("heading", { name: "Events", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+Shift+K");
  await expect(workspaceSwitcher(page)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+K");
  await expect(workspaceSwitcher(page)).toHaveCount(0);
});

test("keeps the workspace control in the phone's bar with the switcher under it @webkit-mobile", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.endsWith("-mobile"),
    "the bar is the phone's",
  );
  const email = `switcher-phone-${randomUUID()}@example.test`;
  const readerResponse = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Phone planner" },
  });
  expect(readerResponse.ok()).toBe(true);
  const reader = await readerResponse.json();
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Phone planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  const line = workspaceLine(page);
  await expect(line).toBeInViewport();
  const menu = await openWorkspaceSwitcher(page);
  await expect(menu).toBeInViewport();
  await expect(
    workspaceEntry(page, reader.workspace.displayName),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    menu.getByRole("menuitem", { name: "Members", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});
