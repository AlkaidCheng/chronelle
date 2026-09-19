import { randomUUID } from "node:crypto";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  moveToTrash,
  outcomeNotice,
  removeFromEvent,
} from "./helpers/lifecycle";
import { chooseRowAction } from "./helpers/row-menu";
import { openEventView } from "./helpers/event-view";

async function signInAs(page: Page, name: string, email: string) {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
}

async function account(request: APIRequestContext, name: string) {
  const email = `${name.toLowerCase()}-${randomUUID()}@example.test`;
  const signedIn = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email, displayName: name },
    })
  ).json();
  return {
    email,
    headers: { authorization: `Bearer ${signedIn.accessToken}` },
    workspace: signedIn.workspace,
  };
}

const taskRow = (page: Page, name: string) =>
  page.getByRole("row").filter({ hasText: name });

async function openEvent(page: Page, name: string) {
  await page.goto("/events");
  await page.getByRole("link", { name: new RegExp(name, "u") }).click();
  await expect(
    page.getByRole("heading", { level: 1, name, exact: true }),
  ).toBeVisible();
  await openEventView(page, "To-dos");
}

test("names removals by what reverses them and never reports one that was refused @webkit-desktop", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const ana = await account(request, "Ana");
  const ben = await account(request, "Ben");
  const carol = await account(request, "Carol");
  const post = async (url: string, data: unknown) => {
    const response = await request.post(url, { headers: ana.headers, data });
    expect(response.status(), url).toBe(201);
    return response.json();
  };
  const event = await post("/api/events", { displayName: "Harvest supper" });
  await post(`/api/events/${event.id}/resources`, {
    commandId: randomUUID(),
    resource: { objectType: "task", displayName: "Order the cider" },
  });
  await post(`/api/events/${event.id}/resources`, {
    commandId: randomUUID(),
    resource: { objectType: "task", displayName: "Borrow the long table" },
  });
  const benShare = await post("/api/shares", {
    resourceId: event.id,
    principalEmail: ben.email,
    role: "viewer",
  });
  await post("/api/shares", {
    resourceId: event.id,
    principalEmail: carol.email,
    role: "viewer",
  });

  await signInAs(page, "Ana", ana.email);
  await openEvent(page, "Harvest supper");

  // Move to Trash asks one line, then the notice offers Undo, which restores.
  const cider = taskRow(page, "Order the cider");
  await chooseRowAction(page, cider, "Move to Trash");
  await moveToTrash(page, page.getByRole("dialog"));
  await expect(cider).toHaveCount(0);
  await outcomeNotice(page, "Moved to Trash")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(outcomeNotice(page, "Moved to Trash")).toHaveCount(0);
  await expect(cider).toBeVisible();

  // Removing from the event needs no question; Removed links recovers it.
  const table = taskRow(page, "Borrow the long table");
  await chooseRowAction(page, table, "Move to Trash");
  await removeFromEvent(page, page.getByRole("dialog"));
  await expect(table).toHaveCount(0);
  await openEventView(page, "Removed links");
  await page
    .getByRole("article")
    .filter({ hasText: "Borrow the long table" })
    .getByRole("button", { name: "Preview link recovery" })
    .click();
  const recovery = page.getByRole("dialog");
  await recovery.getByRole("checkbox").check();
  await recovery.getByRole("button", { name: "Confirm link recovery" }).click();
  await recovery.getByRole("button", { name: "Close", exact: true }).click();
  await openEventView(page, "To-dos");
  await expect(table).toBeVisible();

  // Removing a share says who loses what; the other account then has none.
  await openEventView(page, "Sharing");
  const access = page.locator(".share-list");
  const carolRow = access.locator("article", { hasText: "Carol" });
  await carolRow.getByRole("button", { name: "Remove share" }).click();
  await expect(carolRow).toContainText(
    "Carol will lose access to Harvest supper.",
  );
  await carolRow.getByRole("button", { name: "Remove share" }).click();
  await expect(outcomeNotice(page, "Share removed")).toBeVisible();
  await expect(carolRow).toHaveCount(0);
  expect(
    (
      await request.get(`/api/events/${event.id}`, {
        headers: { ...carol.headers, "x-workspace-id": ana.workspace.id },
      })
    ).status(),
  ).toBe(404);

  // A removal the API refuses keeps the row and explains; no notice is
  // posted. Ben's share is gone already when Ana asks to remove it.
  expect(
    (
      await request.delete(`/api/shares/${benShare.id}`, {
        headers: ana.headers,
      })
    ).ok(),
  ).toBe(true);
  const benRow = access.locator("article", { hasText: "Ben" });
  await benRow.getByRole("button", { name: "Remove share" }).click();
  await benRow.getByRole("button", { name: "Remove share" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(outcomeNotice(page, "Share removed")).toHaveCount(0);
  await expect(benRow).toBeVisible();
});

test("compares a stale write side by side and saves each way out @webkit-desktop", async ({
  context,
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const ana = await account(request, "Ana");
  const event = await (
    await request.post("/api/events", {
      headers: ana.headers,
      data: { displayName: "Harvest supper" },
    })
  ).json();
  const task = (
    await (
      await request.post(`/api/events/${event.id}/resources`, {
        headers: ana.headers,
        data: {
          commandId: randomUUID(),
          resource: { objectType: "task", displayName: "Order the cider" },
        },
      })
    ).json()
  ).resource;
  await signInAs(page, "Ana", ana.email);
  await openEvent(page, "Harvest supper");

  // The second tab is the same account elsewhere.
  const other = await context.newPage();

  const editor = (tab: Page) =>
    tab.getByRole("dialog", { name: "Edit task", exact: true });
  // The row menu's Edit opens the row in place; More at the composer's
  // foot reaches the dialog, where the comparison is exercised.
  async function openEditor(tab: Page, name: string): Promise<Locator> {
    await chooseRowAction(tab, taskRow(tab, name), "Edit");
    await tab.getByRole("button", { name: /^More: / }).click();
    await expect(editor(tab)).toBeVisible();
    return editor(tab);
  }
  async function saveElsewhere(name: string, fields: Record<string, string>) {
    // The other tab reads the event afresh: it has no draft to protect.
    await openEvent(other, "Harvest supper");
    const dialog = await openEditor(other, name);
    for (const [label, value] of Object.entries(fields))
      await dialog.getByLabel(label, { exact: true }).fill(value);
    await dialog
      .getByRole("button", { name: "Save task", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
  }
  const comparison = (dialog: Locator) =>
    dialog.getByRole("alert").filter({
      hasText: "Saved elsewhere while you edited",
    });

  // Keep mine: the draft goes over the newest version as a new version.
  let dialog = await openEditor(page, "Order the cider");
  await saveElsewhere("Order the cider", { Task: "Order the cider, two kegs" });
  await dialog.getByLabel("Task", { exact: true }).fill("Order the dry cider");
  await dialog.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(comparison(dialog)).toBeVisible();
  await expect(comparison(dialog)).toContainText("Ana");
  await expect(comparison(dialog)).toContainText("Order the dry cider");
  await expect(comparison(dialog)).toContainText("Order the cider, two kegs");
  await comparison(dialog)
    .getByRole("button", { name: "Keep mine", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(taskRow(page, "Order the dry cider")).toBeVisible();

  // Take theirs: the draft is dropped for the newest version.
  dialog = await openEditor(page, "Order the dry cider");
  await saveElsewhere("Order the dry cider", { Task: "Order the sweet cider" });
  await dialog.getByLabel("Task", { exact: true }).fill("Order the pear cider");
  await dialog.getByRole("button", { name: "Save task", exact: true }).click();
  await comparison(dialog)
    .getByRole("button", { name: "Take theirs", exact: true })
    .click();
  await expect(dialog.getByLabel("Task", { exact: true })).toHaveValue(
    "Order the sweet cider",
  );
  await expect(
    dialog.getByRole("button", { name: "Save task", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // Merge fields: a field only one side changed is kept from that side; a
  // field both changed defaults to theirs.
  dialog = await openEditor(page, "Order the sweet cider");
  await saveElsewhere("Order the sweet cider", {
    Task: "Order the cider from the farm",
  });
  await dialog.getByLabel("Task", { exact: true }).fill("Order the cider");
  await dialog.getByLabel("Location", { exact: true }).fill("Orchard gate");
  await dialog.getByRole("button", { name: "Save task", exact: true }).click();
  await comparison(dialog)
    .getByRole("button", { name: "Merge fields", exact: true })
    .click();
  const merge = comparison(dialog);
  await expect(merge.getByRole("row", { name: /Location/ })).toContainText(
    "kept",
  );
  await expect(
    merge
      .getByRole("row", { name: /Name/ })
      .getByRole("radio", { name: "Order the cider from the farm" }),
  ).toBeChecked();
  await merge
    .getByRole("button", { name: "Save merged version", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const merged = taskRow(page, "Order the cider from the farm");
  await expect(merged).toBeVisible();
  await expect(merged).toContainText("Orchard gate");

  // History keeps every version, theirs included.
  const versions = await (
    await request.get(`/api/objects/${task.id}/revisions?limit=20`, {
      headers: ana.headers,
    })
  ).json();
  expect(versions.items.length).toBeGreaterThanOrEqual(6);
  await chooseRowAction(page, merged, "History");
  const history = page.locator("dialog.history-drawer");
  await expect(history).toBeVisible();
  await expect(history.getByRole("listitem").first()).toContainText(
    "Edited (content)",
  );
  await other.close();
});
