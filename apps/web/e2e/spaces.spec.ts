import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { openWorkspaceSwitcher, workspaceBlock } from "./helpers/quiet-chrome";

const signIn = async (page: Page, name: string, email: string) => {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
};

test("creates a space with a friend as Owner, who sees it with that role @webkit-desktop", async ({
  page,
  request,
}) => {
  const anaEmail = `ana-${randomUUID()}@example.test`;
  const benEmail = `ben-${randomUUID()}@example.test`;
  const account = async (email: string, displayName: string) =>
    (
      await request.post("/api/auth/development/sign-in", {
        data: { email, displayName },
      })
    ).json();
  const ana = await account(anaEmail, "Ana");
  const ben = await account(benEmail, "Ben");
  const bearer = (session: { accessToken: string }) => ({
    authorization: `Bearer ${session.accessToken}`,
  });
  const sent = await (
    await request.post("/api/friends/invitations", {
      headers: bearer(ana),
      data: { email: benEmail },
    })
  ).json();
  expect(
    (
      await request.post(`/api/friends/requests/${sent.id}/accept`, {
        headers: bearer(ben),
      })
    ).status(),
  ).toBe(200);

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, "Ana", anaEmail);

  // New space sits beside the switcher's search field.
  const switcher = await openWorkspaceSwitcher(page);
  await expect(
    switcher.getByRole("searchbox", { name: "Find a space" }),
  ).toBeFocused();
  await switcher.getByRole("menuitem", { name: "New space" }).click();
  const dialog = page.getByRole("dialog", { name: "New space" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill("Our wedding");
  await dialog
    .getByRole("combobox", { name: "Add a friend" })
    .selectOption({ label: `Ben (${benEmail})` });
  await dialog
    .getByRole("combobox", { name: "Role for Ben" })
    .selectOption("owner");
  await expect(dialog.getByRole("list", { name: "Members" })).toContainText(
    "AnaYouOwner",
  );
  await dialog.getByRole("button", { name: "Create space" }).click();
  await expect(dialog).toHaveCount(0);

  // The new space opens at once, with Ana as its Owner.
  await expect(page).toHaveURL(/\/events$/u);
  await expect(workspaceBlock(page)).toContainText("Our wedding");
  const again = await openWorkspaceSwitcher(page);
  const current = again.getByRole("menuitemradio", { checked: true });
  await expect(current).toContainText("Our wedding");
  await expect(current).toContainText("Owner");
  await page.keyboard.press("Escape");

  // Ben reaches it too, as an Owner.
  const bensSession = await (
    await request.get("/api/auth/session", { headers: bearer(ben) })
  ).json();
  expect(bensSession.availableWorkspaces).toContainEqual(
    expect.objectContaining({
      displayName: "Our wedding",
      personal: false,
      role: "owner",
    }),
  );
  expect(errors).toEqual([]);
});

test("manages a space from the switcher: renames it, shares ownership, and leaves it @webkit-desktop", async ({
  page,
  request,
}) => {
  const anaEmail = `ana-${randomUUID()}@example.test`;
  const benEmail = `ben-${randomUUID()}@example.test`;
  const account = async (email: string, displayName: string) =>
    (
      await request.post("/api/auth/development/sign-in", {
        data: { email, displayName },
      })
    ).json();
  const ana = await account(anaEmail, "Ana");
  const ben = await account(benEmail, "Ben");
  const bearer = (session: { accessToken: string }) => ({
    authorization: `Bearer ${session.accessToken}`,
  });
  const sent = await (
    await request.post("/api/friends/invitations", {
      headers: bearer(ana),
      data: { email: benEmail },
    })
  ).json();
  await request.post(`/api/friends/requests/${sent.id}/accept`, {
    headers: bearer(ben),
  });
  // Ana's space "Our wedding", with Ben as an Editor.
  const space = await (
    await request.post("/api/workspaces", {
      headers: bearer(ana),
      data: { displayName: "Our wedding" },
    })
  ).json();
  expect(
    (
      await request.post("/api/workspaces/current/members", {
        headers: { ...bearer(ana), "x-workspace-id": space.id },
        data: { friendId: sent.id, role: "editor" },
      })
    ).status(),
  ).toBe(201);

  await signIn(page, "Ana", anaEmail);
  const switcher = await openWorkspaceSwitcher(page);
  await switcher.getByRole("menuitemradio", { name: /Our wedding/ }).click();
  await expect(workspaceBlock(page)).toContainText("Our wedding");

  // Manage space opens over the page, on its members.
  await (
    await openWorkspaceSwitcher(page)
  )
    .getByRole("menuitem", { name: "Manage space" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Manage space" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Members" })).toBeVisible();
  const members = dialog.getByRole("list", { name: "Members" });
  await expect(members).toContainText("Ana");
  const bensRole = dialog.getByRole("combobox", { name: "Role for Ben" });
  await expect(bensRole).toHaveValue("editor");

  // Ana is the last Owner: she cannot leave yet.
  await dialog.getByRole("button", { name: "Danger zone" }).click();
  await expect(
    dialog.getByRole("button", { name: "Leave space" }),
  ).toBeDisabled();
  await expect(dialog).toContainText(
    "Make another member an Owner before leaving",
  );

  // She renames the space and makes Ben an Owner.
  await dialog.getByRole("button", { name: "General" }).click();
  await dialog.getByLabel("Name").fill("Kyoto 2027");
  await dialog.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("Renamed to Kyoto 2027")).toBeVisible();
  await dialog.getByRole("button", { name: "Members" }).click();
  await dialog
    .getByRole("combobox", { name: "Role for Ben" })
    .selectOption("owner");
  await expect(
    dialog.getByRole("combobox", { name: "Role for Ben" }),
  ).toHaveValue("owner");

  // With another Owner, she leaves, and her own space opens.
  await dialog.getByRole("button", { name: "Danger zone" }).click();
  const leave = dialog.getByRole("button", { name: "Leave space" });
  await leave.click();
  await leave.click();
  await expect(dialog).toHaveCount(0);
  await expect(workspaceBlock(page)).toContainText("Personal");
  const bensSession = await (
    await request.get("/api/auth/session", { headers: bearer(ben) })
  ).json();
  expect(bensSession.availableWorkspaces).toContainEqual(
    expect.objectContaining({
      id: space.id,
      displayName: "Kyoto 2027",
      role: "owner",
    }),
  );
});
