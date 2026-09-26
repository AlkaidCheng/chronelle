import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { isPhone, workspaceBlock } from "./helpers/quiet-chrome";
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
  // with the access line (a tag beside the date on a phone), without a
  // workspace switch.
  await kyotoCard.click();
  await expect(page).toHaveURL(new RegExp(`/events/${kyoto.id}$`, "u"));
  await expect(
    page.getByRole("heading", { name: "Kyoto in November", level: 1 }),
  ).toBeVisible();
  if (isPhone(page))
    await expect(page.locator(".event-access-tag")).toHaveText(
      /Shared by Ana.*Viewer/,
    );
  else
    await expect(
      page.getByText("Shared with you by Ana as viewer"),
    ).toBeVisible();
  await page.getByRole("tab", { name: "To-dos", exact: true }).click();
  await expect(page.getByText("Book the ryokan")).toBeVisible();
  // The chrome stays on Ben's own workspace: the block that names it still reads Personal.
  await expect(workspaceBlock(page)).toContainText("Personal");
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

test("saves an edit of a task in an event shared for editing, where the task lives, and Undo edit takes it back", async ({
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
  const created = await request.post("/api/events", {
    headers: anaHeaders,
    data: { displayName: "Garden wedding", startsOn: "2030-10-11" },
  });
  expect(created.status()).toBe(201);
  const wedding = await created.json();
  const added = await request.post(`/api/events/${wedding.id}/resources`, {
    headers: anaHeaders,
    data: {
      commandId: randomUUID(),
      resource: { objectType: "task", displayName: "Call the florist" },
    },
  });
  expect(added.status()).toBe(201);
  const task = (await added.json()).resource;
  const shared = await request.post("/api/shares", {
    headers: anaHeaders,
    data: { resourceId: wedding.id, principalEmail: benEmail, role: "editor" },
  });
  expect(shared.status()).toBe(201);
  const description = async () =>
    (
      await (
        await request.get(`/api/tasks/${task.id}`, { headers: benHeaders })
      ).json()
    ).description;

  // Ben edits the task from his own session; the save lands in Ana's
  // workspace, where the task lives.
  await signIn(page, "Ben", benEmail);
  await page.goto(`/events/${wedding.id}?view=todos`);
  await page
    .getByRole("button", { name: "Edit Call the florist", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Peonies, not roses");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/commands") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect.poll(description).toBe("Peonies, not roses");

  // The page's Undo edit acts on Ben's stack in Ana's workspace.
  await page
    .getByRole("button", { name: "Actions for Garden wedding", exact: true })
    .click();
  await page
    .getByRole("menu", { name: "Actions for Garden wedding" })
    .getByRole("menuitem", { name: /^Undo edit/ })
    .click();
  await expect.poll(description).toBeNull();
});
