import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { exerciseComponentCatalog } from "./helpers/component-catalog";

test("inserts repeated component views without copying canonical records", async ({
  page,
  request,
}, testInfo) => {
  const email = `catalog-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const session = await signedIn.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Plans for a gathering" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const detailUrl = `/api/events/${event.id}/detail`;
  const before = await (await request.get(detailUrl, { headers })).json();
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("link", { name: /Plans for a gathering/ }).click();
  await exerciseComponentCatalog(page, testInfo);
  expect(await (await request.get(detailUrl, { headers })).json()).toEqual(
    before,
  );
  const saved = await (
    await request.get(`/api/events/${event.id}/layout`, { headers })
  ).json();
  expect(saved).toMatchObject({
    version: 4,
    pages: [
      { name: "Preparation", components: [{ kind: "todos" }] },
      {
        name: "During the event: activities, people, and places",
        components: [{ kind: "todos" }],
      },
    ],
  });
  expect(saved.pages[0].components[0].id).not.toBe(
    saved.pages[1].components[0].id,
  );
});
