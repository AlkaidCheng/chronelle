import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { exerciseScheduleRefinement } from "./helpers/schedule-refinement";

test("navigates optional ranges and saves only explicitly chosen times @webkit-desktop @webkit-mobile", async ({
  page,
  request,
}, testInfo) => {
  const email = `schedule-${randomUUID()}@example.test`;
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await exerciseScheduleRefinement(page, testInfo);
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const session = await signedIn.json();
  const events = await request.get("/api/events", {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  expect(events.status()).toBe(200);
  const timestamps = await page.evaluate(() => ({
    startsAt: new Date("2028-02-28T10:00").toISOString(),
    endsAt: new Date("2028-02-28T11:00").toISOString(),
  }));
  expect((await events.json()).items).toEqual([
    expect.objectContaining({
      displayName: "Leap-day gathering",
      version: 1,
      startsOn: null,
      endsOn: null,
      ...timestamps,
    }),
  ]);
});
