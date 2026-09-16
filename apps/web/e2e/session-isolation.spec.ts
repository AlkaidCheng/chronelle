import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { signOutFromMenu, switchWorkspace } from "./helpers/quiet-chrome";

test("isolates a delayed collection page across workspace changes and sign-out", async ({
  page,
  request,
}) => {
  const email = `session-${randomUUID()}@example.test`;
  const firstIdentity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Session planner" },
  });
  const secondIdentity = await request.post("/api/auth/development/sign-in", {
    data: {
      email: `shared-${randomUUID()}@example.test`,
      displayName: "Shared planner",
    },
  });
  expect(firstIdentity.ok()).toBe(true);
  expect(secondIdentity.ok()).toBe(true);
  const first = await firstIdentity.json();
  const second = await secondIdentity.json();
  for (let index = 0; index < 21; index += 1) {
    const privateEvent = await request.post("/api/events", {
      headers: { authorization: `Bearer ${first.accessToken}` },
      data: {
        displayName: `Personal collection item ${index}`,
        timezone: "UTC",
      },
    });
    expect(privateEvent.status()).toBe(201);
  }
  const sharedEvent = await request.post("/api/events", {
    headers: { authorization: `Bearer ${second.accessToken}` },
    data: { displayName: "Shared collection item", timezone: "UTC" },
  });
  expect(sharedEvent.status()).toBe(201);
  const shared = await sharedEvent.json();
  const grant = await request.post("/api/shares", {
    headers: { authorization: `Bearer ${second.accessToken}` },
    data: { resourceId: shared.id, principalEmail: email, role: "viewer" },
  });
  expect(grant.status()).toBe(201);

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const delayed = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const delivered = Promise.withResolvers<void>();
  await page.route(
    (url) => url.pathname === "/api/events" && url.searchParams.has("cursor"),
    async (route) => {
      if (route.request().headers()["x-workspace-id"] !== first.workspace.id) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      delayed.resolve();
      await release.promise;
      await route.fulfill({ response });
      delivered.resolve();
    },
    { times: 1 },
  );

  try {
    await page.goto("/sign-in/development");
    await page.getByLabel("Name", { exact: true }).fill("Session planner");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("status", { name: "Event count" })).toHaveText(
      "20 events loaded",
    );
    await page.getByRole("button", { name: "Load more events" }).click();
    await delayed.promise;
    await switchWorkspace(page, second.workspace.displayName);
    await expect(
      page.getByRole("link", { name: /Shared collection item/u }),
    ).toBeVisible();
    release.resolve();
    await delivered.promise;
    await expect(page.getByRole("status", { name: "Event count" })).toHaveText(
      "1 event loaded",
    );
    await expect(
      page.getByRole("link", { name: /Personal collection item/u }),
    ).toHaveCount(0);
    await signOutFromMenu(page);
    await expect(page).toHaveURL(/\/sign-in$/u);
    await page.goto("/sign-in/development");
    await page.getByLabel("Name", { exact: true }).fill("Fresh planner");
    await page.getByLabel("Email").fill(`fresh-${randomUUID()}@example.test`);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/events$/u);
    await expect(
      page.getByRole("link", { name: /collection item/u }),
    ).toHaveCount(0);
    await expect(page.getByRole("status", { name: "Event count" })).toHaveText(
      "0 events loaded",
    );
    expect(errors).toEqual([]);
  } finally {
    release.resolve();
  }
});
