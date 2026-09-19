import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { openEventView } from "./helpers/event-view";
import { switchWorkspace } from "./helpers/quiet-chrome";

const signIn = async (page: Page, name: string, email: string) => {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
};

// The sign-in page re-renders under a signed-in account, so an account
// signs out through its profile menu before the next signs in.
const signOut = async (page: Page, name: string) => {
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in/u);
};

test("shares one view, then one section, and the friend sees that alone; the Sharing view names both @webkit-desktop", async ({
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
  // Ana and Ben are friends, so Ben is offered under Friends.
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
  // Kyoto: a Venue section with one task, a loose task, and an expense.
  const event = await (
    await request.post("/api/events", {
      headers: anaHeaders,
      data: { displayName: "Kyoto in November" },
    })
  ).json();
  const venue = await (
    await request.post(`/api/events/${event.id}/sections`, {
      headers: anaHeaders,
      data: { view: "todos", name: "Venue" },
    })
  ).json();
  for (const resource of [
    { objectType: "task", displayName: "Book the hall", sectionId: venue.id },
    { objectType: "task", displayName: "Order the cake" },
    {
      objectType: "expense",
      displayName: "Venue deposit",
      amount: "240.0000",
      currency: "USD",
      occurredAt: "2030-11-03T12:00:00.000Z",
    },
  ]) {
    expect(
      (
        await request.post(`/api/events/${event.id}/resources`, {
          headers: anaHeaders,
          data: { commandId: randomUUID(), resource },
        })
      ).status(),
    ).toBe(201);
  }

  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (/_rsc=.*access control checks/u.test(error.message)) return;
    errors.push(error.message);
  });

  // Ana shares To-dos with Ben from the view's head row.
  await signIn(page, "Ana", anaEmail);
  await page.getByRole("link", { name: /Kyoto in November/ }).click();
  await openEventView(page, "To-dos");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Share To-dos" });
  await expect(sheet).toContainText("Only you see this so far.");
  await sheet.getByRole("button", { name: "Add people", exact: true }).click();
  await sheet
    .getByRole("list", { name: "Friends" })
    .getByRole("checkbox", { name: /Ben/ })
    .check();
  await sheet.getByRole("button", { name: "Share with 1 person" }).click();
  await expect(
    sheet.getByRole("combobox", { name: "Role for Ben" }),
  ).toHaveValue("viewer");
  await sheet.getByRole("button", { name: "Done", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Share", exact: true }),
  ).toBeFocused();

  // Ben, in Ana's workspace, opens the event: To-dos alone, its rows, no pages.
  await signOut(page, "Ana");
  await signIn(page, "Ben", benEmail);
  await switchWorkspace(page, ana.workspace.displayName);
  await page.getByRole("link", { name: /Kyoto in November/ }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Kyoto in November" }),
  ).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "Event views", exact: true });
  await expect(tabs.getByRole("tab")).toHaveText(["To-dos"]);
  await expect(page.getByText("Book the hall")).toBeVisible();
  await expect(page.getByText("Order the cake")).toBeVisible();
  // The To-dos table names its section head row by the section.
  await expect(page.getByRole("row", { name: /^Venue/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Share", exact: true }),
  ).toHaveCount(0);
  // The other views read as empty for Ben, not as refused.
  expect(
    (
      await request.get(`/api/events/${event.id}/expenses`, {
        headers: { ...benHeaders, "x-workspace-id": ana.workspace.id },
      })
    ).status(),
  ).toBe(200);

  // Ana narrows the share to the Venue section: Share section from its menu.
  await signOut(page, "Ben");
  await signIn(page, "Ana", anaEmail);
  await page.getByRole("link", { name: /Kyoto in November/ }).click();
  await openEventView(page, "To-dos");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Share To-dos" })
    .getByRole("button", { name: "Remove Ben" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Share To-dos" }),
  ).toContainText("Only you see this so far.");
  await page
    .getByRole("dialog", { name: "Share To-dos" })
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await page.getByRole("button", { name: "Actions for Venue" }).click();
  await page.getByRole("menuitem", { name: "Share section" }).click();
  const sectionSheet = page.getByRole("dialog", { name: "Share Venue" });
  await expect(sectionSheet).toContainText(
    "Everyone here sees this section's records; the rest of the view stays as shared.",
  );
  await sectionSheet
    .getByRole("button", { name: "Add people", exact: true })
    .click();
  await sectionSheet
    .getByRole("list", { name: "Friends" })
    .getByRole("checkbox", { name: /Ben/ })
    .check();
  await sectionSheet
    .getByRole("button", { name: "Share with 1 person" })
    .click();
  await expect(
    sectionSheet.getByRole("combobox", { name: "Role for Ben" }),
  ).toHaveValue("viewer");
  await sectionSheet.getByRole("button", { name: "Done", exact: true }).click();

  // The Sharing view names the narrowed share under Ben.
  await openEventView(page, "Sharing");
  const access = page.locator(".share-list");
  await expect(access.getByText("Ben", { exact: true })).toBeVisible();
  await expect(access.getByText("Shared section: Venue")).toBeVisible();

  // Ben sees the section's task alone.
  await signOut(page, "Ana");
  await signIn(page, "Ben", benEmail);
  await switchWorkspace(page, ana.workspace.displayName);
  await page.getByRole("link", { name: /Kyoto in November/ }).click();
  await expect(tabs.getByRole("tab")).toHaveText(["To-dos"]);
  await expect(page.getByText("Book the hall")).toBeVisible();
  await expect(page.getByText("Order the cake")).toHaveCount(0);
  expect(errors).toEqual([]);
});
