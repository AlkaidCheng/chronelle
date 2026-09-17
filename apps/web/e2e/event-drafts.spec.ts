import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { exerciseEventDrafts } from "./helpers/event-drafts";

test("protects creation drafts and creates exactly one canonical date-only event @webkit-desktop @webkit-mobile", async ({
  page,
  request,
}, testInfo) => {
  const email = `drafts-${randomUUID()}@example.test`;
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await exerciseEventDrafts(page, testInfo);
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const session = await signedIn.json();
  const events = await request.get("/api/events", {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  expect(events.status()).toBe(200);
  expect((await events.json()).items).toEqual([
    expect.objectContaining({
      displayName: "Summer gathering",
      version: 1,
      startsOn: "2030-07-03",
      endsOn: "2030-07-12",
      startsAt: null,
      endsAt: null,
    }),
  ]);
});
