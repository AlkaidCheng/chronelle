import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import {
  exerciseContextCommands,
  openCommands,
} from "./helpers/context-commands";
import { switchWorkspace } from "./helpers/quiet-chrome";

test("opens event controls through Commands and saves only explicit layout changes @webkit-desktop @webkit-mobile", async ({
  page,
  request,
}, testInfo) => {
  const email = `context-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.ok()).toBe(true);
  const session = await signedIn.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "A gathering with friends and family" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("link", { name: /A gathering with friends and family/ })
    .click();
  await exerciseContextCommands(page, testInfo, { canShare: true });
  const layout = await (
    await request.get(`/api/events/${event.id}/layout`, { headers })
  ).json();
  expect(layout).toMatchObject({
    version: 2,
    pages: [{ components: [{ kind: "todos" }] }],
  });
  expect(layout.pages).toHaveLength(1);
  expect(layout.pages[0].components).toHaveLength(1);
  expect(
    await (await request.get(`/api/events/${event.id}`, { headers })).json(),
  ).toEqual(event);
});

test("limits Viewer commands and denies history after access is revoked @webkit-desktop @webkit-mobile", async ({
  page,
  request,
}) => {
  const email = `viewer-context-${randomUUID()}@example.test`;
  const viewer = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Viewer" },
  });
  expect(viewer.ok()).toBe(true);
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: {
      email: `owner-context-${randomUUID()}@example.test`,
      displayName: "Owner",
    },
  });
  expect(signedIn.ok()).toBe(true);
  const owner = await signedIn.json();
  const headers = { authorization: `Bearer ${owner.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Shared gathering" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const shared = await request.post("/api/shares", {
    headers,
    data: { resourceId: event.id, principalEmail: email, role: "viewer" },
  });
  expect(shared.status()).toBe(201);
  const grant = await shared.json();
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Viewer");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await switchWorkspace(page, owner.workspace.displayName);
  await page.getByRole("link", { name: /Shared gathering/ }).click();
  const commands = await openCommands(page);
  await expect(
    commands.getByRole("group", { name: "Event actions" }).getByRole("option"),
  ).toHaveCount(1);
  await expect(
    commands.getByRole("option", {
      name: /Edit event|Share event|Add page|Add component/,
    }),
  ).toHaveCount(0);
  expect(
    (await request.delete(`/api/shares/${grant.id}`, { headers })).ok(),
  ).toBe(true);
  const denied = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/objects/${event.id}/revisions`) &&
      response.status() === 404,
  );
  await commands.getByRole("option", { name: /Event history/ }).click();
  await denied;
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.reload();
  await openCommands(page);
  await expect(
    commands.getByRole("group", { name: "Event actions" }),
  ).toHaveCount(0);
});
