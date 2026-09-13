import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { exerciseScheduleInspector } from "./helpers/schedule-inspector";

test("edits and recovers one scheduled Event across projections", async ({
  page,
  request,
}, testInfo) => {
  const email = `schedule-${randomUUID()}@example.test`;
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
  const scheduled = await request.post(`/api/events/${event.id}/resources`, {
    headers,
    data: {
      commandId: randomUUID(),
      resource: {
        objectType: "event",
        displayName: "Welcome",
        startsOn: "2030-07-03",
        endsOn: "2030-07-05",
      },
    },
  });
  expect(scheduled.status()).toBe(201);
  const { resource: item } = await scheduled.json();
  await page.goto("/sign-in");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("link", { name: /Garden evening/ }).click();
  await exerciseScheduleInspector(page, testInfo);
  const canonical = await request.get(`/api/events/${item.id}`, { headers });
  expect(canonical.status()).toBe(200);
  expect(await canonical.json()).toMatchObject({
    id: item.id,
    displayName: "Recovered schedule item",
    version: 2,
    startsOn: "2030-07-03",
    endsOn: "2030-07-05",
    startsAt: null,
  });
});
