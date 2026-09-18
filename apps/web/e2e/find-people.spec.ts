import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "./fixtures";

const signOut = async (page: Page, name: string) => {
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in/u);
};

const signIn = async (page: Page, name: string, email: string) => {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
};

test("finds people as they allow, keeps a username with its code, and sends a request from the code page @webkit-desktop", async ({
  page,
  request,
}, testInfo) => {
  const tag = randomUUID().slice(0, 8);
  const anaEmail = `ana-${tag}@example.test`;
  const benEmail = `ben-${tag}@example.test`;
  const cidEmail = `cid-${tag}@example.test`;
  const account = async (email: string, displayName: string) => {
    const response = await request.post("/api/auth/development/sign-in", {
      data: { email, displayName },
    });
    expect(response.ok()).toBe(true);
    const session = await response.json();
    return {
      id: session.user.id as string,
      headers: { authorization: `Bearer ${session.accessToken}` },
    };
  };
  const ana = await account(anaEmail, `Ana ${tag}`);
  const ben = await account(benEmail, `Ben ${tag}`);
  const cid = await account(cidEmail, `Cid ${tag}`);
  const patch = async (
    headers: Record<string, string>,
    data: Record<string, unknown>,
  ) => {
    const response = await request.patch("/api/account", { headers, data });
    expect(response.status(), JSON.stringify(data)).toBe(200);
  };
  // Usernames came from the names: ben-<tag>, cid-<tag>, ana-<tag>.
  await patch(cid.headers, { findByName: false });
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    // WebKit reports a link prefetch cut short by the next navigation as
    // an access control failure; it is not an application error.
    if (/_rsc=.*access control checks/u.test(error.message)) return;
    errors.push(error.message);
  });

  // Ana signed in without choosing: her username came from her name.
  await signIn(page, `Ana ${tag}`, anaEmail);
  await page.goto("/friends");

  // Find people: by name (Cid hides his), by @username, by email.
  await page
    .getByRole("button", { name: "Invite a friend", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Invite a friend" });
  const search = dialog.getByRole("searchbox", { name: "Find people" });
  await search.fill(tag);
  const results = dialog.getByRole("list", { name: "Find people" });
  await expect(results).toContainText(`Ben ${tag}`);
  await expect(results).not.toContainText(`Cid ${tag}`);
  await expect(results).not.toContainText(`Ana ${tag}`);
  await search.fill(`@cid-${tag}`);
  await expect(results).toContainText(`Cid ${tag}`);
  await search.fill(cidEmail);
  await expect(results).toContainText(`Cid ${tag}`);
  await page.screenshot({ path: testInfo.outputPath("find-people.png") });
  await search.fill(`ben ${tag}`);
  await expect(results).toContainText(`Ben ${tag}`);
  await results
    .getByRole("button", { name: "Add friend", exact: true })
    .click();
  await expect(results).toContainText("Request sent");
  await dialog.getByRole("button", { name: "Close invitation" }).click();
  await expect(page.getByRole("region", { name: /Sent/ })).toContainText(
    benEmail,
  );

  // Ben sees the request; Cid hides his email and is not found by it.
  const benFriends = await request.get("/api/friends", {
    headers: ben.headers,
  });
  expect((await benFriends.json()).incoming).toHaveLength(1);
  await patch(cid.headers, { findByEmail: false });
  await page
    .getByRole("button", { name: "Invite a friend", exact: true })
    .click();
  await search.fill(cidEmail);
  await expect(dialog.getByRole("status")).toContainText("No one matches");
  await dialog.getByRole("button", { name: "Close invitation" }).click();
  await expect(dialog).toHaveCount(0);

  // Your code shows the link, which opens on Cid's side with Add friend.
  await page.getByRole("button", { name: "Your code", exact: true }).click();
  const code = page.getByRole("dialog", { name: "Your code" });
  await expect(code.getByRole("img", { name: /QR code/ })).toBeVisible();
  await expect(code).toContainText(`@ana-${tag}`);
  await page.screenshot({ path: testInfo.outputPath("your-code.png") });
  await code.getByRole("button", { name: "Close your code" }).click();
  await expect(code).toHaveCount(0);

  // Signed out, the code page asks for a sign-in and returns to itself.
  await signOut(page, `Ana ${tag}`);
  await page.goto(`/u/ana-${tag}`);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/u);
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(`Cid ${tag}`);
  await page.getByLabel("Email").fill(cidEmail);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/u/ana-${tag}$`, "u"));
  await expect(
    page.getByRole("heading", { level: 1, name: `Ana ${tag}` }),
  ).toBeVisible();
  await expect(page.getByText(`signed in as Cid ${tag}`)).toBeVisible();
  await page.getByRole("button", { name: "Add friend", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Request sent");
  await page.screenshot({ path: testInfo.outputPath("code-page.png") });
  const anaFriends = await request.get("/api/friends", {
    headers: ana.headers,
  });
  expect(
    (await anaFriends.json()).incoming.map(
      (item: { requester: { userId: string } }) => item.requester.userId,
    ),
  ).toEqual([cid.id]);

  // Settings: the username as chosen, and the switches.
  await page.goto("/settings");
  await expect(page.getByText(`@cid-${tag}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Username" })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "By name" })).not.toBeChecked();
  await expect(
    page.getByRole("switch", { name: "By email" }),
  ).not.toBeChecked();
  await page.getByRole("switch", { name: "By name" }).click();
  await expect(page.getByRole("switch", { name: "By name" })).toBeChecked();
  const me = await request.get("/api/auth/session", { headers: cid.headers });
  expect((await me.json()).user).toMatchObject({
    username: `cid-${tag}`,
    findByName: true,
    findByEmail: false,
  });
  expect(errors).toEqual([]);
});
