import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("saves composed pages through the API and keeps canonical tasks after layout removal", async ({
  page,
  request,
}, testInfo) => {
  const email = `pages-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Event planner" },
  });
  expect(identity.status()).toBe(200);
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  await page.goto("/sign-in");
  await page.getByLabel("Name", { exact: true }).fill("Event planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "New event", exact: true }).click();
  await page.getByLabel("Event name").fill("Summer vacation");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]+$/u);
  const eventId = new URL(page.url()).pathname.split("/").at(-1);
  await expect(
    page.getByRole("heading", { name: "A place for your event" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  await page.getByLabel("Page name").fill("Preparation");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add page", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add component", exact: true })
    .click();
  await page.getByRole("button", { name: "Add To-dos", exact: true }).click();
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page.getByLabel("Task", { exact: true }).fill("Pack for the trip");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/resources") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  const creation = await created;
  expect(creation.status()).toBe(201);
  const { resource: task } = await creation.json();
  await expect(
    page.getByText("Pack for the trip", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Preparation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pack for the trip", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("composed-event-page.png"),
    fullPage: true,
  });
  const layout = await request.get(`/api/events/${eventId}/layout`, {
    headers,
  });
  expect(layout.status()).toBe(200);
  expect(await layout.json()).toMatchObject({
    version: 2,
    pages: [{ name: "Preparation", components: [{ kind: "todos" }] }],
  });
  const removed = await request.patch(`/api/events/${eventId}/layout`, {
    headers,
    data: { expectedVersion: 2, pages: [] },
  });
  expect(removed.status()).toBe(200);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "A place for your event" }),
  ).toBeVisible();
  const canonical = await request.get(`/api/objects/${task.id}`, { headers });
  expect(canonical.status()).toBe(200);
  expect(await canonical.json()).toEqual(task);
  const projection = await request.get(`/api/events/${eventId}/todos`, {
    headers,
  });
  expect(projection.status()).toBe(200);
  expect(
    (await projection.json()).items.map((item: { id: string }) => item.id),
  ).toEqual([task.id]);
});
