import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";

const signIn = async (page: Page, name: string, email: string) => {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
};

test("shares an event with a friend and queues one for a person without an account @webkit-desktop", async ({
  page,
  request,
}) => {
  const anaEmail = `ana-${randomUUID()}@example.test`;
  const benEmail = `ben-${randomUUID()}@example.test`;
  const priyaEmail = `priya-${randomUUID()}@example.test`;
  const ana = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email: anaEmail, displayName: "Ana" },
    })
  ).json();
  const ben = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email: benEmail, displayName: "Ben" },
    })
  ).json();
  const anaHeaders = { authorization: `Bearer ${ana.accessToken}` };
  const benHeaders = { authorization: `Bearer ${ben.accessToken}` };
  // Ana and Ben are friends; Priya is a card with an email and no account.
  const sent = await (
    await request.post("/api/friends/invitations", {
      headers: anaHeaders,
      data: { email: benEmail },
    })
  ).json();
  expect(
    (
      await request.post(`/api/friends/requests/${sent.id}/accept`, {
        headers: benHeaders,
      })
    ).status(),
  ).toBe(200);
  const event = await (
    await request.post("/api/events", {
      headers: anaHeaders,
      data: { displayName: "Kyoto in November" },
    })
  ).json();
  expect(
    (
      await request.post("/api/persons", {
        headers: anaHeaders,
        data: {
          displayName: "Priya Raman",
          contacts: [{ kind: "email", value: priyaEmail }],
        },
      })
    ).status(),
  ).toBe(201);

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, "Ana", anaEmail);
  await page.getByRole("link", { name: /Kyoto in November/ }).click();
  await page.getByRole("button", { name: "Share event", exact: true }).click();

  // Ben is offered under Friends with a role beside his name; Priya under
  // the other people, with the note that an invitation goes out.
  const friends = page.getByRole("list", { name: "Friends" });
  const others = page.getByRole("list", { name: "Others in People" });
  await expect(friends.getByRole("checkbox", { name: /Ben/ })).toBeVisible();
  await expect(
    others.getByRole("checkbox", { name: /Priya Raman/ }),
  ).toBeVisible();
  await expect(
    others.getByText(new RegExp(`${priyaEmail}; an invitation goes out`)),
  ).toBeVisible();
  await friends.getByRole("checkbox", { name: /Ben/ }).check();
  await page
    .getByRole("combobox", { name: "Access for Ben" })
    .selectOption("owner");
  await others.getByRole("checkbox", { name: /Priya Raman/ }).check();
  await page.getByRole("button", { name: "Share with 2 people" }).click();
  await expect(friends.getByText("Shared as Owner")).toBeVisible();
  await expect(
    others.getByText("Invitation sent; access follows when they join"),
  ).toBeVisible();

  // People with access lists Ben's grant and Priya's waiting share; the
  // waiting share can be taken back.
  const access = page.locator(".share-list");
  await expect(access.getByText("Ben", { exact: true })).toBeVisible();
  await expect(access.getByText("Priya Raman", { exact: true })).toBeVisible();
  await expect(access.getByText(/Access follows when they join/)).toBeVisible();
  const shares = await (
    await request.get(`/api/objects/${event.id}/shares`, {
      headers: anaHeaders,
    })
  ).json();
  expect(shares.items).toMatchObject([
    { principal: { id: ben.user.id }, role: "owner" },
  ]);
  expect(shares.pending).toMatchObject([
    {
      person: { displayName: "Priya Raman" },
      role: "viewer",
      kind: "invitation",
    },
  ]);
  const anasFriends = await (
    await request.get("/api/friends", { headers: anaHeaders })
  ).json();
  expect(anasFriends.sent).toMatchObject([
    { kind: "invitation", email: priyaEmail },
  ]);
  // Ben reaches the event in Ana's workspace.
  expect(
    (
      await request.get(`/api/events/${event.id}`, {
        headers: { ...benHeaders, "x-workspace-id": ana.workspace.id },
      })
    ).status(),
  ).toBe(200);
  // A queued share is taken back without a question: nobody loses access.
  await access
    .locator("article", { hasText: "Priya Raman" })
    .getByRole("button", { name: "Remove share" })
    .click();
  await expect(access.getByText("Priya Raman", { exact: true })).toHaveCount(0);
  expect(
    (
      await (
        await request.get(`/api/objects/${event.id}/shares`, {
          headers: anaHeaders,
        })
      ).json()
    ).pending,
  ).toEqual([]);
  // The People page marks Priya as invited and Ben, whose card the accept
  // linked, as a friend.
  await page.getByRole("link", { name: "People", exact: true }).click();
  await expect(
    page.getByRole("listitem", { name: "Priya Raman", exact: true }),
  ).toContainText("Invited");
  expect(errors).toEqual([]);
});

test("adds a friend to the workspace as a member from Settings @webkit-desktop", async ({
  page,
  request,
}) => {
  const anaEmail = `ana-${randomUUID()}@example.test`;
  const benEmail = `ben-${randomUUID()}@example.test`;
  const ana = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email: anaEmail, displayName: "Ana" },
    })
  ).json();
  const ben = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email: benEmail, displayName: "Ben" },
    })
  ).json();
  const anaHeaders = { authorization: `Bearer ${ana.accessToken}` };
  const benHeaders = { authorization: `Bearer ${ben.accessToken}` };
  const sent = await (
    await request.post("/api/friends/invitations", {
      headers: anaHeaders,
      data: { email: benEmail },
    })
  ).json();
  expect(
    (
      await request.post(`/api/friends/requests/${sent.id}/accept`, {
        headers: benHeaders,
      })
    ).status(),
  ).toBe(200);

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, "Ana", anaEmail);
  await page.getByRole("button", { name: /^Ana/ }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: "Members", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings\/members$/u);
  const members = page.getByRole("list", { name: "Members" });
  await expect(members.getByRole("listitem")).toHaveCount(1);
  await expect(members).toContainText("Ana");
  await expect(members).toContainText("Personal workspace");

  // Ben is the one friend to add; as a viewer he sees Ana's workspace.
  await page.getByRole("combobox", { name: "Friend" }).selectOption({
    label: `Ben (${benEmail})`,
  });
  await page.getByRole("combobox", { name: "Access" }).selectOption("viewer");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(members.getByRole("listitem")).toHaveCount(2);
  await expect(members.getByRole("listitem").nth(1)).toContainText("Ben");
  await expect(members.getByRole("listitem").nth(1)).toContainText("Viewer");
  await expect(
    page.getByText("Befriend someone first to add them here."),
  ).toBeVisible();
  const bensSession = await (
    await request.get("/api/auth/session", { headers: benHeaders })
  ).json();
  expect(
    bensSession.availableWorkspaces.map(
      (workspace: { id: string }) => workspace.id,
    ),
  ).toContain(ana.workspace.id);

  // Removing him ends his access.
  const benRow = members.getByRole("listitem").nth(1);
  await benRow.getByRole("button", { name: "Remove member" }).click();
  await expect(benRow).toContainText("will lose access to this workspace.");
  await benRow.getByRole("button", { name: "Remove member" }).click();
  await expect(members.getByRole("listitem")).toHaveCount(1);
  const after = await (
    await request.get("/api/auth/session", { headers: benHeaders })
  ).json();
  expect(
    after.availableWorkspaces.map((workspace: { id: string }) => workspace.id),
  ).not.toContain(ana.workspace.id);
  expect(errors).toEqual([]);
});
