import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { exerciseEventInspector } from "./helpers/event-inspector";

test("edits one canonical Event through a responsive inspector @webkit-desktop @webkit-mobile", async ({
  page,
  request,
}, testInfo) => {
  const email = `inspector-${randomUUID()}@example.test`;
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await exerciseEventInspector(page, testInfo);
  const response = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(response.status()).toBe(200);
  const session = await response.json();
  const events = await request.get("/api/events", {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  expect(events.status()).toBe(200);
  expect((await events.json()).items).toEqual([
    expect.objectContaining({
      displayName: "Saved garden evening",
      version: 2,
      startsAt: null,
      startsOn: null,
    }),
  ]);
});
