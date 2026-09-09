import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  exerciseWorkspaceUtilities,
  openWorkspaceSettings,
} from "./helpers/workspace-utilities";

test("keeps workspace utilities accessible without changing Event data", async ({
  page,
  request,
}, testInfo) => {
  const email = `utilities-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Workspace planner" },
  });
  expect(identity.ok()).toBe(true);
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Quiet afternoon" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  await page.goto("/sign-in");
  await page.getByLabel("Name", { exact: true }).fill("Workspace planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  await page.getByRole("link", { name: /Quiet afternoon/ }).click();
  await exerciseWorkspaceUtilities(page, testInfo);
  expect(
    await (await request.get(`/api/events/${event.id}`, { headers })).json(),
  ).toEqual(event);
});

test("rejects a workspace choice whose last grant was revoked", async ({
  page,
  request,
}) => {
  const email = `viewer-${randomUUID()}@example.test`;
  const viewerResponse = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Viewer" },
  });
  const ownerResponse = await request.post("/api/auth/development/sign-in", {
    data: { email: `owner-${randomUUID()}@example.test`, displayName: "Owner" },
  });
  expect(viewerResponse.ok()).toBe(true);
  expect(ownerResponse.ok()).toBe(true);
  const viewer = await viewerResponse.json();
  const owner = await ownerResponse.json();
  const headers = { authorization: `Bearer ${owner.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Private shared event" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const shared = await request.post("/api/shares", {
    headers,
    data: { resourceId: event.id, principalEmail: email, role: "viewer" },
  });
  expect(shared.status()).toBe(201);
  const grant = await shared.json();
  await page.goto("/sign-in");
  await page.getByLabel("Name", { exact: true }).fill("Viewer");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  const dialog = await openWorkspaceSettings(page);
  const select = dialog.getByRole("combobox", {
    name: "Workspace",
    exact: true,
  });
  await expect(
    select.locator("option", { hasText: owner.workspace.displayName }),
  ).toHaveCount(1);
  expect(
    (await request.delete(`/api/shares/${grant.id}`, { headers })).ok(),
  ).toBe(true);
  const deniedSession = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/session") && response.status() === 404,
  );
  await select.selectOption(owner.workspace.id);
  await deniedSession;
  await expect(dialog).toHaveCount(0);
  const returned = await openWorkspaceSettings(page);
  await expect(
    returned.getByRole("combobox", { name: "Workspace", exact: true }),
  ).toHaveValue(viewer.workspace.id);
  await expect(
    returned.locator(`option[value="${owner.workspace.id}"]`),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("link", { name: /Private shared event/ }),
  ).toHaveCount(0);
});
