import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { exerciseEventArrange } from "./helpers/event-arrange";

test("arranges without losing drafts and preserves canonical records through layout recovery", async ({
  page,
  request,
}, testInfo) => {
  const email = `arrange-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const session = await signedIn.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "A quiet place to plan" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const detailUrl = `/api/events/${event.id}/detail`;
  const before = await (await request.get(detailUrl, { headers })).json();
  await page.goto("/sign-in");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("link", { name: /A quiet place to plan/ }).click();
  await exerciseEventArrange(page, testInfo);
  const layout = await (
    await request.get(`/api/events/${event.id}/layout`, { headers })
  ).json();
  expect(layout).toMatchObject({
    version: 5,
    pages: [
      {
        name: "Preparation",
        components: [{ kind: "todos" }, { kind: "calendar" }],
      },
    ],
  });
  expect(await (await request.get(detailUrl, { headers })).json()).toEqual(
    before,
  );
});
