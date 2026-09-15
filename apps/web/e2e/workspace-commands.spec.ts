import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { exerciseWorkspaceCommands } from "./helpers/workspace-commands";

test("protects Task editor focus and navigates without saving discarded fields", async ({
  page,
  request,
}, testInfo) => {
  const email = `commands-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Event planner" },
  });
  expect(identity.ok()).toBe(true);
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "An afternoon together" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Event planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("link", { name: /An afternoon together/ }).click();
  await exerciseWorkspaceCommands(page, testInfo);
  expect(
    await (await request.get(`/api/events/${event.id}`, { headers })).json(),
  ).toEqual(event);
});

test("persists shortcut opt-out and synchronizes another tab", async ({
  page,
  context,
}) => {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Keyboard planner");
  await page.getByLabel("Email").fill(`shortcuts-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const trigger = page.getByRole("button", { name: "Commands", exact: true });
  await trigger.click();
  await page.getByText("Keyboard shortcuts", { exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Enable command shortcut" })
    .uncheck();
  await page.keyboard.press("Escape");
  await page.reload();
  await trigger.focus();
  await expect(trigger).not.toHaveAttribute("aria-keyshortcuts");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const other = await context.newPage();
  await other.goto("/sign-in/development");
  await other.evaluate(() =>
    localStorage.removeItem("chronelle.command-shortcut"),
  );
  await expect(trigger).toHaveAttribute(
    "aria-keyshortcuts",
    "Control+k Meta+k",
  );
  await trigger.focus();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Commands" })).toBeVisible();
  await other.close();
});
