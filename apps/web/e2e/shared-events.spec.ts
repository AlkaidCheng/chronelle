import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { chooseRowAction } from "./helpers/row-menu";

const signIn = async (page: Page, name: string, email: string) => {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
};

const signOut = async (page: Page, name: string) => {
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in/u);
};

const chip = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "Which events" })
    .getByRole("button", { name: new RegExp(`^${name}`) });

test("shows the events shared with an account beside its own, opens one in place, and lets the account leave it with an undo @webkit-desktop", async ({
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
  const create = async (
    headers: Record<string, string>,
    data: Record<string, string>,
  ) => {
    const response = await request.post("/api/events", { headers, data });
    expect(response.status()).toBe(201);
    return response.json();
  };
  const kyoto = await create(anaHeaders, {
    displayName: "Kyoto in November",
    startsOn: "2030-11-02",
    endsOn: "2030-11-06",
  });
  await create(anaHeaders, { displayName: "A quiet studio weekend" });
  await create(benHeaders, {
    displayName: "Wedding countdown",
    startsOn: "2030-10-11",
  });
  await create(benHeaders, { displayName: "Mount Takao hike" });
  const task = await request.post(`/api/events/${kyoto.id}/resources`, {
    headers: anaHeaders,
    data: {
      commandId: randomUUID(),
      resource: {
        objectType: "task",
        displayName: "Book the ryokan",
        dueOn: "2030-10-20",
      },
    },
  });
  expect(task.status()).toBe(201);
  const shared = await request.post("/api/shares", {
    headers: anaHeaders,
    data: { resourceId: kyoto.id, principalEmail: benEmail, role: "viewer" },
  });
  expect(shared.status()).toBe(201);

  // Ana's own card reads how many it is shared with.
  await signIn(page, "Ana", anaEmail);
  const kyotoCard = page.getByRole("link", { name: /Kyoto in November/ });
  await expect(kyotoCard).toContainText("Shared with 1");
  await expect(chip(page, "All")).toContainText("2");
  await expect(chip(page, "Mine")).toContainText("2");
  await expect(chip(page, "Shared with me")).toContainText("0");
  await signOut(page, "Ana");

  // Ben's list holds Ana's event beside his own, with the by-line.
  await signIn(page, "Ben", benEmail);
  const cards = page.locator(".event-card");
  await expect(cards).toHaveCount(3);
  await expect(kyotoCard).toContainText("Shared by Ana");
  await expect(kyotoCard).toContainText("Viewer");
  await expect(
    page.getByRole("link", { name: /Wedding countdown/ }),
  ).not.toContainText("Shared");
  await expect(chip(page, "All")).toContainText("3");
  await expect(chip(page, "Mine")).toContainText("2");
  await expect(chip(page, "Shared with me")).toContainText("1");

  // The chips filter the list; All shows everything again.
  await chip(page, "Shared with me").click();
  await expect(chip(page, "Shared with me")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Kyoto in November");
  await chip(page, "Mine").click();
  await expect(cards).toHaveCount(2);
  await expect(page.getByText("Kyoto in November")).toHaveCount(0);
  await chip(page, "Upcoming").click();
  await expect(cards).toHaveCount(2);
  await chip(page, "All").click();
  await expect(cards).toHaveCount(3);

  // A viewer's card offers no Share control; its menu offers Leave in
  // place of Move to Trash.
  const kyotoShell = page.locator(".event-card-shell", {
    has: kyotoCard,
  });
  await kyotoShell.hover();
  await expect(
    kyotoShell.getByRole("button", { name: "Share", exact: true }),
  ).toHaveCount(0);
  await kyotoShell.getByRole("button", { name: /^Actions for / }).click();
  const menu = page.getByRole("menu");
  await expect(
    menu.getByRole("menuitem", { name: "Leave this event", exact: true }),
  ).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Move to Trash", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Opening the shared card lands on the event page in Ana's workspace,
  // with the access line, without a workspace switch.
  await kyotoCard.click();
  await expect(page).toHaveURL(new RegExp(`/events/${kyoto.id}$`, "u"));
  await expect(
    page.getByRole("heading", { name: "Kyoto in November", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText("Shared with you by Ana as viewer"),
  ).toBeVisible();
  await page.getByRole("tab", { name: "To-dos", exact: true }).click();
  await expect(page.getByText("Book the ryokan")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Workspace: / }),
  ).toContainText(ben.workspace.displayName);
  await page.getByRole("link", { name: "All events", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);

  // Leaving takes the card off at once; Undo brings it back.
  await chooseRowAction(page, kyotoShell, "Leave this event");
  await expect(cards).toHaveCount(2);
  const notice = page.getByRole("status").filter({
    hasText: "You left Kyoto in November.",
  });
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(cards).toHaveCount(3);
  await expect(kyotoCard).toBeVisible();

  // Leaving and closing the notice settles it: the grant is gone.
  const left = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/objects/${kyoto.id}/leave`) &&
      response.request().method() === "POST",
  );
  await chooseRowAction(page, kyotoShell, "Leave this event");
  await expect(cards).toHaveCount(2);
  await page
    .getByRole("status")
    .filter({ hasText: "You left Kyoto in November." })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  expect((await left).ok()).toBe(true);
  await page.reload();
  await expect(cards).toHaveCount(2);
  await expect(chip(page, "Shared with me")).toContainText("0");
  const gone = await request.get(`/api/events/${kyoto.id}`, {
    headers: benHeaders,
  });
  expect(gone.status()).toBe(404);
});
