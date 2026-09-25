import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { latestCodeFor } from "./helpers/mailbox";

/** Signs the browser in as a development identity, leaving any session first, and waits for the workspace. */
async function signInAs(page: Page, name: string, email: string) {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
}

async function signOut(page: Page, name: string) {
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in/u);
}

/** The token of the link the dialog or panel shows. */
async function linkShown(page: Page): Promise<string> {
  const link = (await page.locator(".invite-link-url").textContent()) ?? "";
  const token = /\/invite\/([\w-]+)$/u.exec(link.trim())?.[1];
  if (token === undefined) throw new Error(`no invitation link in "${link}"`);
  return token;
}

test("invites a card with only a phone by a link; the link makes the friendship, links the card, and applies the queued share @webkit-desktop", async ({
  page,
  request,
}, testInfo) => {
  const anaEmail = `ana-${randomUUID()}@example.test`;
  const benEmail = `ben-${randomUUID()}@example.test`;
  const account = async (email: string, displayName: string) => {
    const response = await request.post("/api/auth/development/sign-in", {
      data: { email, displayName },
    });
    expect(response.ok()).toBe(true);
    const session = await response.json();
    return { headers: { authorization: `Bearer ${session.accessToken}` } };
  };
  const ana = await account(anaEmail, "Ana");
  await account(benEmail, "Ben");
  const create = async (path: string, data: unknown) => {
    const response = await request.post(path, { headers: ana.headers, data });
    expect(response.status(), path).toBe(201);
    return response.json();
  };
  const kyoto = await create("/api/events", {
    displayName: "Kyoto in November",
  });
  const card = await create("/api/persons", {
    displayName: "Ben Okafor",
    contacts: [{ kind: "phone", value: "+44 7700 900123" }],
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (/_rsc=.*access control checks/u.test(error.message)) return;
    errors.push(error.message);
  });

  // Ana makes a link from the card's Connection panel: no email is needed.
  await signInAs(page, "Ana", anaEmail);
  await page.goto(`/people/${card.id}`);
  const connection = page.getByRole("region", {
    name: "Connection",
    exact: true,
  });
  await expect(connection).toContainText("Not linked to an account");
  await connection
    .getByRole("button", { name: "Invite a friend", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Invite a friend",
    exact: true,
  });
  await expect(
    dialog.getByRole("combobox", { name: "Person", exact: true }),
  ).toHaveValue(card.id);
  await expect(
    dialog.getByRole("button", { name: "Send by email", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Note (optional)").fill("Scan this to join.");
  await dialog
    .getByRole("button", { name: "Create link", exact: true })
    .click();
  await expect(dialog).toContainText(
    "Send it in WeChat, a message, or any way you like.",
  );
  await expect(dialog).toContainText("One use. Valid until");
  await page.screenshot({ path: testInfo.outputPath("link-made.png") });
  const token = await linkShown(page);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(connection).toContainText("Invitation link created");
  await expect(connection).toContainText("One use. Valid until");
  await expect(
    connection.getByRole("button", { name: "Copy link", exact: true }),
  ).toBeVisible();
  await expect(
    connection.getByRole("button", { name: "New link", exact: true }),
  ).toBeVisible();
  await expect(
    connection.getByRole("button", { name: "Send by email", exact: true }),
  ).toHaveCount(0);

  // Share Kyoto with the card from its page: the share waits on the link.
  await page
    .getByRole("button", { name: "Share with Ben Okafor", exact: true })
    .click();
  const share = page.getByRole("dialog", { name: "Share with Ben Okafor" });
  await share.getByLabel("Find an event").fill("Kyoto");
  await share.getByRole("radio", { name: /Kyoto in November/ }).click();
  await share.getByRole("button", { name: "Share", exact: true }).click();
  await expect(share.getByRole("status")).toContainText(
    "Kyoto in November queued; waiting on the link",
  );
  await expect(
    share.getByRole("button", { name: "Copy link", exact: true }),
  ).toBeVisible();
  await share.getByRole("button", { name: "Done", exact: true }).click();

  // Ana's own link is refused on the claim page.
  await page.goto(`/invite/${token}`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Ana invited you to be friends on LivTales",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("This is your own invitation link."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(0);
  await page.getByRole("link", { name: "Open LivTales" }).click();
  await signOut(page, "Ana");

  // Signed out, the link names Ana and the note, and asks for a sign-in
  // that returns here; Ben accepts.
  await page.goto(`/invite/${token}`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Ana invited you to be friends on LivTales",
    }),
  ).toBeVisible();
  await expect(page.getByText("Scan this to join.")).toBeVisible();
  await expect(page.getByText("Kyoto in November as viewer")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("claim-signed-out.png") });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/u);
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Ben");
  await page.getByLabel("Email").fill(benEmail);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/invite/${token}$`, "u"));
  await expect(page.getByText(/signed in as Ben/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("claim-signed-in.png") });
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByText("You and Ana are now friends.")).toBeVisible();
  await expect(
    page.getByText("Kyoto in November is shared with you as viewer."),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("claim-accepted.png") });

  // The link is spent; the card is linked to Ben; the share is a grant.
  await page.goto(`/invite/${token}`);
  await expect(
    page.getByText("This invitation was already accepted."),
  ).toBeVisible();
  const linked = await (
    await request.get(`/api/persons/${card.id}`, { headers: ana.headers })
  ).json();
  expect(linked.userId).not.toBeNull();
  const shares = await (
    await request.get(`/api/objects/${kyoto.id}/shares`, {
      headers: ana.headers,
    })
  ).json();
  expect(shares.items).toMatchObject([
    { principal: { id: linked.userId }, role: "viewer" },
  ]);
  expect(shares.pending).toEqual([]);
  const friends = await (
    await request.get("/api/friends", { headers: ana.headers })
  ).json();
  expect(friends.friends).toMatchObject([{ userId: linked.userId }]);
  expect(friends.sent).toEqual([]);
  expect(errors).toEqual([]);
});

test("a friend who opens a link keeps the friendship; a withdrawn link says so @webkit-desktop", async ({
  page,
  request,
}) => {
  const anaEmail = `ana-${randomUUID()}@example.test`;
  const benEmail = `ben-${randomUUID()}@example.test`;
  const account = async (email: string, displayName: string) => {
    const response = await request.post("/api/auth/development/sign-in", {
      data: { email, displayName },
    });
    const session = await response.json();
    return { headers: { authorization: `Bearer ${session.accessToken}` } };
  };
  const ana = await account(anaEmail, "Ana");
  const ben = await account(benEmail, "Ben");
  const requested = await (
    await request.post("/api/friends/invitations", {
      headers: ana.headers,
      data: { email: benEmail },
    })
  ).json();
  await request.post(`/api/friends/requests/${requested.id}/accept`, {
    headers: ben.headers,
  });
  const link = await (
    await request.post("/api/friends/invitations", {
      headers: ana.headers,
      data: { channel: "link" },
    })
  ).json();
  const token = /\/invite\/([\w-]+)$/u.exec(link.inviteUrl)?.[1] ?? "";
  const withdrawn = await (
    await request.post("/api/friends/invitations", {
      headers: ana.headers,
      data: { channel: "link" },
    })
  ).json();
  await request.delete(`/api/friends/invitations/${withdrawn.id}`, {
    headers: ana.headers,
  });
  const gone = /\/invite\/([\w-]+)$/u.exec(withdrawn.inviteUrl)?.[1] ?? "";

  await signInAs(page, "Ben", benEmail);
  await page.goto(`/invite/${token}`);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByText("You were already friends.")).toBeVisible();
  await page.goto(`/invite/${gone}`);
  await expect(
    page.getByText("This invitation is no longer open."),
  ).toBeVisible();
  await page.goto("/invite/not-a-real-token-0001");
  await expect(page.getByText(/No invitation has this link/)).toBeVisible();
});

test("someone new signs up through the link, completes Welcome, and accepts @webkit-desktop", async ({
  page,
  request,
}) => {
  const tag = randomUUID().slice(0, 8);
  const anaEmail = `ana-${tag}@example.test`;
  const newcomer = `dan-${tag}@example.test`;
  const session = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email: anaEmail, displayName: "Ana" },
    })
  ).json();
  const link = await (
    await request.post("/api/friends/invitations", {
      headers: { authorization: `Bearer ${session.accessToken}` },
      data: { channel: "link", message: "Come along." },
    })
  ).json();
  const token = /\/invite\/([\w-]+)$/u.exec(link.inviteUrl)?.[1] ?? "";

  await page.goto(`/invite/${token}`);
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/sign-up\\?invitation=${token}$`, "u"),
  );
  await page.getByLabel("Email").fill(newcomer);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("textbox", { name: "Username" }).fill(`dan-${tag}`);
  await expect(page.getByRole("status")).toContainText("is available.");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email\?email=/u);
  await page
    .getByLabel("Verification code")
    .fill(await latestCodeFor(newcomer));
  await page.getByRole("button", { name: "Confirm" }).click();
  // Welcome first, then back to the link, where Accept is explicit.
  await expect(page).toHaveURL(/\/welcome$/u);
  await page.getByRole("textbox", { name: "Name" }).fill(`Dan ${tag}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`/invite/${token}$`, "u"));
  await expect(page.getByText("Come along.")).toBeVisible();
  await expect(
    page.getByText(new RegExp(`signed in as Dan ${tag}`)),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByText("You and Ana are now friends.")).toBeVisible();
  const friends = await (
    await request.get("/api/friends", {
      headers: { authorization: `Bearer ${session.accessToken}` },
    })
  ).json();
  expect(friends.friends).toMatchObject([{ displayName: `Dan ${tag}` }]);
  expect(friends.sent).toEqual([]);
});
