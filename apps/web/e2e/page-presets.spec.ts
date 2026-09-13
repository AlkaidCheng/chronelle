import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { exercisePagePresets } from "./helpers/page-presets";

test("adds preset pages and recovers their identities without changing planning records", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(60_000);
  const email = `presets-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const session = await signedIn.json();
  const headers = {
    authorization: `Bearer ${session.accessToken}`,
    // Verification reads use fresh sockets after the interactive journey.
    connection: "close",
  };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "A shared plan" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const task = await request.post(`/api/events/${event.id}/resources`, {
    headers,
    data: {
      commandId: randomUUID(),
      resource: { objectType: "task", displayName: "Confirm the venue" },
    },
  });
  expect(task.status()).toBe(201);
  const detailUrl = `/api/events/${event.id}/detail`;
  const before = await (await request.get(detailUrl, { headers })).json();
  await page.goto("/sign-in");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("link", { name: /A shared plan/ }).click();
  await exercisePagePresets(page, testInfo);
  expect(await (await request.get(detailUrl, { headers })).json()).toEqual(
    before,
  );
  const saved = await (
    await request.get(`/api/events/${event.id}/layout`, { headers })
  ).json();
  expect(saved).toMatchObject({
    version: 5,
    pages: [
      { name: "Preparation", components: [] },
      {
        name: "On the day",
        components: [
          { kind: "todos" },
          { kind: "itinerary" },
          { kind: "expenses" },
        ],
      },
      {
        name: "Multi-day",
        components: [
          { kind: "calendar" },
          { kind: "itinerary" },
          { kind: "files" },
        ],
      },
    ],
  });
  const history = await (
    await request.get(`/api/events/${event.id}/layout/history`, { headers })
  ).json();
  expect(
    history.items.find((item: { version: number }) => item.version === 3)
      ?.pages,
  ).toEqual(saved.pages);
});
