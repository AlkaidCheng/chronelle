import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "./fixtures";
import { exerciseTaskEditors } from "./helpers/task-editors";
import { openTaskEditor } from "./helpers/task-add";
import { openEventView } from "./helpers/event-view";

async function openTaskEvent(page: Page, request: APIRequestContext) {
  const email = `task-editor-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const session = await signedIn.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Garden evening" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("link", { name: /Garden evening/ }).click();
  return { event, headers };
}

test("creates and edits one canonical Task through focused surfaces @webkit-desktop @webkit-mobile", async ({
  page,
  request,
}, testInfo) => {
  const { event, headers } = await openTaskEvent(page, request);
  const creation = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/events/${event.id}/resources`) &&
      response.request().method() === "POST",
  );
  await exerciseTaskEditors(page, testInfo);
  const response = await creation;
  expect(response.status()).toBe(201);
  const task = (await response.json()).resource;
  const canonical = await request.get(`/api/tasks/${task.id}`, { headers });
  expect(canonical.status()).toBe(200);
  expect(await canonical.json()).toMatchObject({
    id: task.id,
    version: 4,
    permissionScopeId: event.id,
    displayName: "Pack garden supplies and chairs",
    dueAt: task.dueAt,
    durationMinutes: 30,
    status: "todo",
  });
  const tasks = await request.get(`/api/events/${event.id}/todos`, { headers });
  expect(tasks.status()).toBe(200);
  expect((await tasks.json()).items).toEqual([
    expect.objectContaining({ id: task.id, version: 4 }),
  ]);
  await page.reload();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "Pack garden supplies and chairs" }),
  ).toHaveCount(1);
});

test("retries a lost Task creation response without duplicating its resource or link @webkit-desktop @webkit-mobile", async ({
  page,
  request,
}) => {
  const { event, headers } = await openTaskEvent(page, request);
  await openEventView(page, "To-dos");
  await openTaskEditor(page);
  const dialog = page.getByRole("dialog", { name: "Add task", exact: true });
  const name = dialog.getByLabel("Task", { exact: true });
  await name.fill("Confirm the garden gate");
  const endpoint = `/api/events/${event.id}/resources`;
  let savedId: string | undefined;
  let commandId: string | undefined;
  await page.route(
    `**${endpoint}`,
    async (route) => {
      commandId = route.request().postDataJSON().commandId;
      const saved = await route.fetch();
      expect(saved.status()).toBe(201);
      savedId = (await saved.json()).resource.id;
      await route.abort("failed");
    },
    { times: 1 },
  );
  await name.press("ControlOrMeta+Enter");
  await expect(dialog.getByRole("alert")).toContainText("could not be reached");
  await expect(name).toHaveValue("Confirm the garden gate");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(name).toBeFocused();
  const retry = page.waitForResponse(
    (response) =>
      response.url().endsWith(endpoint) &&
      response.request().method() === "POST",
  );
  await name.press("ControlOrMeta+Enter");
  const saved = await retry;
  expect(saved.status()).toBe(201);
  expect(saved.request().postDataJSON().commandId).toBe(commandId);
  expect((await saved.json()).resource.id).toBe(savedId);
  await expect(dialog).toHaveCount(0);
  const tasks = await request.get(`/api/events/${event.id}/todos`, { headers });
  expect(tasks.status()).toBe(200);
  expect((await tasks.json()).items).toEqual([
    expect.objectContaining({ id: savedId, version: 1, dueAt: null }),
  ]);
  const relations = await request.get(`/api/objects/${event.id}/relations`, {
    headers,
  });
  expect(relations.status()).toBe(200);
  expect(
    (await relations.json()).items.filter(
      (relation: { targetObjectId: string }) =>
        relation.targetObjectId === savedId,
    ),
  ).toHaveLength(1);
});
