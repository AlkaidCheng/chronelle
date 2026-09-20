import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { addMember } from "./helpers/membership";
import { openWorkspaceSwitcher, workspaceEntry } from "./helpers/quiet-chrome";
import { exerciseWorkspaceUtilities } from "./helpers/workspace-utilities";

test("keeps workspace utilities accessible without changing Event data @webkit-desktop @webkit-mobile", async ({
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
  await page.goto("/sign-in/development");
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

test("rejects a workspace choice whose membership was withdrawn @webkit-desktop @webkit-mobile", async ({
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
  // The viewer joins the owner's workspace; the switcher lists the
  // membership, and the choice fails once the owner withdraws it.
  await addMember(request, owner, { ...viewer, email });
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Viewer");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  const menu = await openWorkspaceSwitcher(page);
  const ownerWorkspace = workspaceEntry(page, owner.workspace.displayName);
  await expect(ownerWorkspace).toHaveCount(1);
  expect(
    (
      await request.delete(
        `/api/workspaces/current/members/${viewer.user.id}`,
        { headers },
      )
    ).ok(),
  ).toBe(true);
  const deniedSession = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/session") && response.status() === 404,
  );
  await ownerWorkspace.click();
  await deniedSession;
  await expect(menu).toHaveCount(0);
  await openWorkspaceSwitcher(page);
  await expect(
    workspaceEntry(page, viewer.workspace.displayName),
  ).toHaveAttribute("aria-checked", "true");
  await expect(workspaceEntry(page, owner.workspace.displayName)).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("link", { name: /Private shared event/ }),
  ).toHaveCount(0);
});
