import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { openCollection } from "./helpers/quiet-chrome";

/** Signs the browser in as a development identity, leaving any session first. */
async function signInAs(page: Page, name: string, email: string) {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: /^Ana|^Ben/ }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in/u);
}

async function openFriends(page: Page, name: string) {
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.getByRole("menuitem", { name: /^Friends/ }).click();
  await expect(page).toHaveURL(/\/friends$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Friends", exact: true }),
  ).toBeVisible();
}

test("connects two accounts through a request and links a person to the friend @webkit-desktop", async ({
  page,
  request,
}) => {
  const anaEmail = `ana-${randomUUID()}@example.test`;
  const benEmail = `ben-${randomUUID()}@example.test`;
  // Ben has an account already, so Ana's invitation is a request to it.
  const ben = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email: benEmail, displayName: "Ben" },
    })
  ).json();
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    // WebKit reports a link prefetch cut short by the next navigation (the
    // sign-in page's Sign up link, while the journey leaves for the
    // development sign-in) as an access control failure; it is not an
    // application error.
    if (/_rsc=.*access control checks/u.test(error.message)) return;
    errors.push(error.message);
  });

  await signInAs(page, "Ana", anaEmail);
  await openFriends(page, "Ana");
  await expect(
    page.getByText("No friends yet", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Invite a friend", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Invite a friend",
    exact: true,
  });
  await dialog.getByLabel("Email (optional)", { exact: true }).fill(benEmail);
  await dialog.getByLabel("Note (optional)").fill("Climbing on Saturday?");
  await dialog
    .getByRole("button", { name: "Send by email", exact: true })
    .click();
  // An address with an account gets a request, so there is no link to show.
  await expect(dialog).toHaveCount(0);
  const sent = page.getByRole("region", { name: /^Sent/ });
  await expect(sent).toContainText(benEmail);
  await expect(sent).toContainText("Request");
  // The same address cannot be invited twice while it waits.
  await page
    .getByRole("button", { name: "Invite a friend", exact: true })
    .click();
  await dialog.getByLabel("Email (optional)", { exact: true }).fill(benEmail);
  await dialog
    .getByRole("button", { name: "Send by email", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "An invitation is already waiting.",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await signOut(page);

  // Ben sees the request with the note, and a mark on the profile block.
  await signInAs(page, "Ben", benEmail);
  await expect(page.locator(".profile-dot")).toBeVisible();
  await openFriends(page, "Ben");
  const requests = page.getByRole("region", { name: /^Requests/ });
  await expect(requests).toContainText("Ana");
  await expect(requests).toContainText(anaEmail);
  await expect(requests).toContainText("Climbing on Saturday?");
  await requests.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByRole("region", { name: /^Requests/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: /^Friends/ })).toContainText(
    "Ana",
  );
  await expect(page.locator(".profile-dot")).toHaveCount(0);
  await signOut(page);

  // Ana links a person of her workspace to Ben and sees his email on the card.
  await signInAs(page, "Ana", anaEmail);
  await openFriends(page, "Ana");
  await expect(page.getByRole("region", { name: /^Friends/ })).toContainText(
    "Ben",
  );
  await expect(page.getByRole("region", { name: /^Sent/ })).toHaveCount(0);
  await openCollection(page, "People");
  await page.getByRole("button", { name: "New person", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add person", exact: true });
  // The typed name narrows the accounts under the field to Ben; the pick
  // links the card and fills his name, which the full name then replaces.
  const name = editor.getByRole("combobox", { name: "Name", exact: true });
  await name.fill("be");
  await editor
    .getByRole("option", { name: `Ben ${benEmail} Friend`, exact: true })
    .click();
  await expect(name).toHaveValue("Ben");
  await expect(editor.locator(".person-link-mark")).toHaveText(/^Friend/);
  await name.fill("Benjamin");
  await editor.getByRole("button", { name: "Add person", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const card = page.getByRole("listitem", { name: "Benjamin", exact: true });
  await expect(card).toContainText("Friend");
  const people = await (
    await request.get("/api/persons?query=Benjamin", {
      headers: { authorization: `Bearer ${ben.accessToken}` },
    })
  ).json();
  expect(people.items).toEqual([]);

  // Ben removes the connection; Ana's list is empty again.
  await signOut(page);
  await signInAs(page, "Ben", benEmail);
  await openFriends(page, "Ben");
  const friends = page.getByRole("region", { name: /^Friends/ });
  await friends
    .getByRole("button", { name: "Remove friend", exact: true })
    .click();
  await expect(friends).toContainText(
    "Shares you gave each other stay until removed.",
  );
  await friends
    .getByRole("button", { name: "Remove friend", exact: true })
    .click();
  await expect(page.locator(".notice-toast")).toContainText("Friend removed");
  await expect(
    page.getByText("No friends yet", { exact: false }),
  ).toBeVisible();
  await signOut(page);
  await signInAs(page, "Ana", anaEmail);
  await openFriends(page, "Ana");
  await expect(
    page.getByText("No friends yet", { exact: false }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("invites an address without an account, shows the link, and keeps it under Sent @webkit-desktop", async ({
  page,
}) => {
  const anaEmail = `ana-${randomUUID()}@example.test`;
  const newcomer = `new-${randomUUID()}@example.test`;
  await signInAs(page, "Ana", anaEmail);
  await openFriends(page, "Ana");
  await page
    .getByRole("button", { name: "Invite a friend", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Invite a friend",
    exact: true,
  });
  await dialog.getByLabel("Email (optional)", { exact: true }).fill(newcomer);
  await dialog
    .getByRole("button", { name: "Send by email", exact: true })
    .click();
  // The link is shown with its code and end; Done closes.
  await expect(dialog).toContainText(`Sent by email to ${newcomer}.`);
  await expect(dialog).toContainText("One use. Valid until");
  await expect(
    dialog.getByRole("img", { name: "QR code of the invitation link" }),
  ).toBeVisible();
  await expect(dialog.locator(".invite-link-url")).toContainText("/invite/");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const sent = page.getByRole("region", { name: /^Sent/ });
  await expect(sent).toContainText(newcomer);
  await expect(sent).toContainText("Email");
  await expect(sent).toContainText("One use. Valid until");
  await expect(
    sent.getByRole("button", { name: "Copy link", exact: true }),
  ).toBeVisible();
  await expect(
    sent.getByRole("button", { name: "Resend", exact: true }),
  ).toBeVisible();
  await sent
    .getByRole("button", { name: "Withdraw invitation", exact: true })
    .click();
  await expect(page.getByRole("region", { name: /^Sent/ })).toHaveCount(0);
});
