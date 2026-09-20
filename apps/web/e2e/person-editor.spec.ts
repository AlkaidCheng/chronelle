import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openCollection } from "./helpers/quiet-chrome";

/** Two development accounts made friends through a request and its acceptance. */
async function befriend(
  request: APIRequestContext,
  from: { accessToken: string },
  toEmail: string,
  to: { accessToken: string },
) {
  const invited = await request.post("/api/friends/invitations", {
    data: { email: toEmail, channel: "email" },
    headers: { authorization: `Bearer ${from.accessToken}` },
  });
  expect(invited.status()).toBe(201);
  const waiting = await (
    await request.get("/api/friends", {
      headers: { authorization: `Bearer ${to.accessToken}` },
    })
  ).json();
  const accepted = await request.post(
    `/api/friends/requests/${waiting.incoming[0].id}/accept`,
    { headers: { authorization: `Bearer ${to.accessToken}` } },
  );
  expect(accepted.status()).toBe(200);
}

test("links a person to an account from the Name field @webkit-desktop", async ({
  page,
  request,
}) => {
  const anaEmail = `ana-${randomUUID()}@example.test`;
  const benEmail = `ben-${randomUUID()}@example.test`;
  const signIn = (email: string, displayName: string) =>
    request
      .post("/api/auth/development/sign-in", { data: { email, displayName } })
      .then((response) => response.json());
  const ana = await signIn(anaEmail, "Ana");
  const ben = await signIn(benEmail, "Ben");
  await befriend(request, ana, benEmail, ben);
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (/_rsc=.*access control checks/u.test(error.message)) return;
    errors.push(error.message);
  });

  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Ana");
  await page.getByLabel("Email").fill(anaEmail);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
  await openCollection(page, "People");
  await page.getByRole("button", { name: "New person", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add person", exact: true });

  // The dialog is one column: the name with the nickname beside it, then
  // the rows, and nothing under the footer.
  const name = editor.getByRole("combobox", { name: "Name", exact: true });
  await expect(name).toBeFocused();
  await expect(editor.getByLabel("Nickname", { exact: true })).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "Add contact", exact: true }),
  ).toBeVisible();
  await expect(editor.getByText("Drafts stay")).toHaveCount(0);
  await expect(editor.locator("kbd")).toHaveCount(0);

  // With the field focused and empty, the lookup lists Ana's own account
  // first and her friend after it; typing narrows the friends by name or
  // email while the own account stays pinned.
  const accounts = editor.getByRole("listbox", { name: "Accounts" });
  await expect(accounts.getByRole("option")).toHaveText([
    /^AAna.*You$/,
    /^BBen.*Friend$/,
  ]);
  await name.fill("nobody");
  await expect(accounts.getByRole("option")).toHaveText([/^AAna.*You$/]);
  await name.fill(benEmail.slice(0, 8));
  await expect(accounts.getByRole("option")).toHaveText([
    /^AAna.*You$/,
    /^BBen.*Friend$/,
  ]);

  // The keyboard walks the list; Enter picks Ben: the name fills, the mark
  // reads Friend, and his email becomes a contact row.
  await name.press("ArrowDown");
  await name.press("ArrowDown");
  await expect(
    accounts.getByRole("option", { name: `Ben ${benEmail} Friend` }),
  ).toHaveAttribute("aria-selected", "true");
  await name.press("Enter");
  await expect(accounts).toHaveCount(0);
  await expect(name).toHaveValue("Ben");
  await expect(editor.locator(".person-link-mark")).toHaveText(/^Friend/);
  await expect(
    editor.getByRole("button", { name: `Email: ${benEmail}`, exact: true }),
  ).toBeVisible();

  // Unlink keeps the name and the contact; the lookup returns on focus, and
  // a click picks him again. The name stays editable once linked.
  await editor.getByRole("button", { name: "Unlink", exact: true }).click();
  await expect(editor.locator(".person-link-mark")).toHaveCount(0);
  await expect(name).toHaveValue("Ben");
  await name.click();
  await accounts
    .getByRole("option", { name: `Ben ${benEmail} Friend` })
    .click();
  await expect(editor.locator(".person-link-mark")).toHaveText(/^Friend/);
  await expect(
    editor.getByRole("button", { name: `Email: ${benEmail}`, exact: true }),
  ).toHaveCount(1);
  await name.fill("Benjamin");
  await editor.getByLabel("Nickname", { exact: true }).fill("Benji");

  // A phone contact opens in place as kind + value; Escape from it leaves
  // the row reading the value. A description and a field go in as rows.
  await editor
    .getByRole("button", { name: "Add contact", exact: true })
    .click();
  await editor.getByLabel("Contact 2 kind").selectOption("phone");
  await editor.getByLabel("Contact 2 value").fill("+1 555 0100");
  await editor.getByLabel("Contact 2 value").press("Escape");
  await expect(
    editor.getByRole("button", { name: "Phone: +1 555 0100", exact: true }),
  ).toBeFocused();
  await expect(editor).toBeVisible();
  await editor.getByLabel("Description", { exact: true }).fill("Climbs.");
  await editor.getByRole("button", { name: "Add field", exact: true }).click();
  await editor.getByLabel("Field 1 name").fill("birthday");
  await editor.getByLabel("Field 1 value").fill("14 March");
  await editor.getByRole("button", { name: "Add person", exact: true }).click();
  await expect(editor).toHaveCount(0);

  // The card reads as a friend's; the record carries the link, the name,
  // and the contacts in order.
  const card = page.getByRole("listitem", { name: "Benji", exact: true });
  await expect(card).toContainText("Friend");
  const people = await (
    await request.get("/api/persons?query=Benjamin", {
      headers: { authorization: `Bearer ${ana.accessToken}` },
    })
  ).json();
  expect(people.items).toMatchObject([
    {
      displayName: "Benjamin",
      nickname: "Benji",
      userId: ben.user.id,
      contacts: [
        { kind: "email", value: benEmail },
        { kind: "phone", value: "+1 555 0100" },
      ],
      description: "Climbs.",
      customProperties: { birthday: "14 March" },
    },
  ]);

  // Editing shows the mark; a second card cannot take Ben again, so the
  // lookup offers only Ana's own account.
  await page.getByRole("button", { name: "New person", exact: true }).click();
  await expect(accounts.getByRole("option")).toHaveText([/^AAna.*You$/]);
  await page.keyboard.press("Escape");
  await expect(accounts).toHaveCount(0);
  await expect(editor).toBeVisible();
  expect(errors).toEqual([]);
});
