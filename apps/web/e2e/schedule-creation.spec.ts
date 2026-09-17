import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import {
  expectCreatedSchedule,
  prepareScheduleCreation,
} from "./helpers/schedule-creation";

test("creates one linked schedule item when retrying a lost response @webkit-desktop @webkit-mobile", async ({
  page,
  request,
}, testInfo) => {
  const email = `schedule-create-${randomUUID()}@example.test`;
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
  await prepareScheduleCreation(page, testInfo);
  const endpoint = `/api/events/${event.id}/resources`;
  let firstCommand: string | undefined;
  let createdId: string | undefined;
  await page.route(
    `**${endpoint}`,
    async (route) => {
      firstCommand = route.request().postDataJSON().commandId;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      createdId = (await response.json()).resource.id;
      await route.abort("failed");
    },
    { times: 1 },
  );
  const dialog = page.getByRole("dialog", {
    name: "Add schedule item",
    exact: true,
  });
  await dialog
    .getByLabel("Schedule item", { exact: true })
    .press("ControlOrMeta+Enter");
  await expect(dialog.getByRole("alert")).toContainText("could not be reached");
  await expect(dialog.getByLabel("Schedule item")).toHaveValue(
    "Garden arrival",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: "Discard schedule item?",
  });
  await expect(confirmation).toContainText(
    "The name and schedule entered here will be cleared.",
  );
  await confirmation
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  const retried = page.waitForResponse(
    (response) =>
      response.url().endsWith(endpoint) &&
      response.request().method() === "POST",
  );
  await dialog.getByLabel("Schedule item").press("ControlOrMeta+Enter");
  const response = await retried;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON().commandId).toBe(firstCommand);
  expect((await response.json()).resource.id).toBe(createdId);
  await expectCreatedSchedule(page);
  const canonical = await request.get(`/api/events/${createdId}`, { headers });
  expect(canonical.status()).toBe(200);
  expect(await canonical.json()).toMatchObject({
    id: createdId,
    version: 1,
    permissionScopeId: event.id,
    displayName: "Garden arrival",
    startsOn: "2030-07-03",
    endsOn: "2030-07-05",
    startsAt: null,
    endsAt: null,
  });
  const calendar = await request.get(`/api/events/${event.id}/calendar`, {
    headers,
  });
  expect(calendar.status()).toBe(200);
  expect((await calendar.json()).items).toHaveLength(1);
});
