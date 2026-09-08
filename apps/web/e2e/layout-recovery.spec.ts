import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("recovers event layouts without altering canonical planning data", async ({
  page,
  request,
}, testInfo) => {
  const email = `layout-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const session = await signedIn.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Summer plans" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const layoutUrl = `/api/events/${event.id}/layout`;
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
      await request.patch(layoutUrl, {
        headers,
        data: { expectedVersion: 0, pages },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.post(`/api/events/${event.id}/resources`, {
        headers,
        data: {
          commandId: randomUUID(),
          resource: { objectType: "task", displayName: "Confirm venue" },
        },
      })
    ).status(),
  ).toBe(201);
  const before = await (
    await request.get(`/api/events/${event.id}/detail`, { headers })
  ).json();
  await page.goto("/sign-in");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  await page.goto(`/events/${event.id}`);
  const options = page.getByRole("button", {
    name: "Page options",
    exact: true,
  });
  await options.click();
  const dialog = page.getByRole("dialog", { name: "Manage event pages" });
  await dialog
    .getByRole("button", { name: "Remove To-dos from Preparation" })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Remove To-dos?" }),
  ).toBeFocused();
  await expect(dialog).toContainText("No planning records will be deleted.");
  await dialog
    .getByRole("button", { name: "Remove from layout", exact: true })
    .click();
  const undo = dialog.getByRole("button", { name: "Undo layout change" });
  const redo = dialog.getByRole("button", { name: "Redo layout change" });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(redo).toBeEnabled();
  expect(
    (await (await request.get(layoutUrl, { headers })).json()).pages,
  ).toEqual(pages);
  await redo.click();
  await expect(redo).toBeDisabled();
  await expect(dialog.getByRole("status")).toContainText("Layout saved.");
  await dialog
    .getByRole("button", { name: "Remove page", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Remove from layout", exact: true })
    .click();
  await expect(dialog.getByText("No pages in this layout")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Layout history", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Preview version 1", exact: true })
    .click();
  await expect(dialog).toContainText("Preparation: To-dos, Calendar");
  await page.screenshot({
    path: testInfo.outputPath("layout-restore-preview.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Restore layout", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Version 6 (current)" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(options).toBeFocused();
  await expect(page.getByText("Confirm venue", { exact: true })).toBeVisible();
  expect(
    await (
      await request.get(`/api/events/${event.id}/detail`, { headers })
    ).json(),
  ).toEqual(before);
  await page.reload();
  await options.click();
  await expect(undo).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Layout history", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Version 6 (current)" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Preview initial layout", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Restore layout", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Version 7 (current)" }),
  ).toBeVisible();
  expect(
    (await (await request.get(layoutUrl, { headers })).json()).pages,
  ).toEqual([]);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Share event", exact: true }).click();
  await expect(page.getByLabel("Collaborator email")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
