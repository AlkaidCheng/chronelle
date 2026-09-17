import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { choosePageOption } from "./helpers/quiet-chrome";

/** The event page's More menu, opened. */
async function openMore(page: Page, eventName: string) {
  await page
    .getByRole("button", { name: `Actions for ${eventName}`, exact: true })
    .click();
  return page.getByRole("menu", { name: `Actions for ${eventName}` });
}

test("undoes and redoes edits by name, keeps layout undo apart, and previews history rows @webkit-desktop @webkit-mobile", async ({
  page,
  request,
}) => {
  const email = `undo-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const headers = {
    authorization: `Bearer ${(await signedIn.json()).accessToken}`,
  };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Autumn retreat" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const pages = [
    {
      id: randomUUID(),
      name: "Preparation",
      components: [
        { id: randomUUID(), kind: "todos" },
        { id: randomUUID(), kind: "calendar" },
      ],
    },
  ];
  expect(
    (
      await request.patch(`/api/events/${event.id}/layout`, {
        headers,
        data: { expectedVersion: 0, pages },
      })
    ).status(),
  ).toBe(200);
  const task = await (
    await request.post(`/api/events/${event.id}/resources`, {
      headers,
      data: {
        commandId: randomUUID(),
        resource: { objectType: "task", displayName: "Book the lodge" },
      },
    })
  ).json();

  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  // The sign-in lands on the collection before the journey moves on;
  // leaving earlier races that redirect.
  await expect(page).toHaveURL(/\/events$/u);
  await page.goto(`/events/${event.id}`);

  // Nothing to undo yet: the item says so and cannot run.
  let more = await openMore(page, "Autumn retreat");
  const undoItem = more.getByRole("menuitem", { name: /^Undo edit/ });
  await expect(undoItem).toHaveAttribute("aria-disabled", "true");
  await expect(undoItem).toContainText("Nothing to undo");
  await page.keyboard.press("Escape");

  // A rename is a command: Undo edit names it and takes it back; Redo edit
  // brings it again.
  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Autumn retreat, moved");
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Autumn retreat, moved",
  );
  more = await openMore(page, "Autumn retreat, moved");
  await more
    .getByRole("menuitem", { name: /Undo: rename Autumn retreat, moved/ })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Autumn retreat",
  );
  more = await openMore(page, "Autumn retreat");
  await more
    .getByRole("menuitem", { name: /Redo: rename Autumn retreat, moved/ })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Autumn retreat, moved",
  );

  // The keyboard reaches the same stack outside text fields.
  await page.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Autumn retreat",
  );
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Autumn retreat, moved",
  );

  // Inside Page options the keys move the layout stack, not the content one.
  await choosePageOption(page, "Page options");
  const dialog = page.getByRole("dialog", { name: "Manage event pages" });
  await dialog
    .getByRole("button", { name: "Remove To-dos from Preparation" })
    .click();
  await dialog
    .getByRole("button", { name: "Remove from layout", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Undo layout change" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Layout history" }).focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(
    dialog.getByRole("button", { name: "Redo layout change" }),
  ).toBeEnabled();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Autumn retreat, moved",
  );
  await dialog
    .getByRole("button", { name: "Layout history", exact: true })
    .click();
  await expect(dialog.getByText("Arranged (layout)").first()).toBeVisible();
  await expect(
    dialog.getByText("Removed component To-dos", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // History rows carry the kind and preview the change before Compare.
  await page
    .getByRole("button", {
      name: "History for Autumn retreat, moved",
      exact: true,
    })
    .click();
  const history = page.locator("dialog.history-drawer");
  await expect(history).toBeVisible();
  const newest = history.getByRole("listitem").first();
  await expect(newest).toContainText("Edited (content)");
  await expect(newest).toContainText(
    "Name: Autumn retreat to Autumn retreat, moved",
  );
  await page.keyboard.press("Escape");

  // Another account's edit makes the head unreachable; the item says why.
  const otherEmail = `other-${randomUUID()}@example.test`;
  const other = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email: otherEmail, displayName: "Guest" },
    })
  ).json();
  const otherHeaders = { authorization: `Bearer ${other.accessToken}` };
  expect(
    (
      await request.post("/api/shares", {
        headers,
        data: {
          resourceId: event.id,
          principalEmail: otherEmail,
          role: "owner",
        },
      })
    ).status(),
  ).toBe(201);
  const current = await (
    await request.get(`/api/events/${event.id}`, { headers })
  ).json();
  expect(
    (
      await request.patch(`/api/events/${event.id}`, {
        headers: {
          ...otherHeaders,
          "x-workspace-id": current.workspaceId,
        },
        data: {
          expectedVersion: current.version,
          displayName: "Autumn retreat, moved again",
        },
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  more = await openMore(page, "Autumn retreat, moved again");
  const blocked = more.getByRole("menuitem", { name: /^Undo edit/ });
  await expect(blocked).toHaveAttribute("aria-disabled", "true");
  await expect(blocked).toContainText("Changed by someone else since");
  expect(task.resource.displayName).toBe("Book the lodge");
});
