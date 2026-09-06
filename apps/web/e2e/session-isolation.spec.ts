import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("isolates a delayed collection across workspace changes and sign-out", async ({
  page,
  request,
}, testInfo) => {
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
  const privateEvent = await request.post("/api/events", {
    headers: { authorization: `Bearer ${first.accessToken}` },
    data: { displayName: "Personal collection item", timezone: "UTC" },
  });
  const sharedEvent = await request.post("/api/events", {
    headers: { authorization: `Bearer ${second.accessToken}` },
    data: { displayName: "Shared collection item", timezone: "UTC" },
  });
  expect(privateEvent.status()).toBe(201);
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
    "**/api/events",
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
    await page.goto("/sign-in");
    await page.getByLabel("Name", { exact: true }).fill("Session planner");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Continue" }).click();
    await delayed.promise;
    if (testInfo.project.name === "chromium-mobile") {
      await page.getByLabel("Account and workspace").click();
    }
    await page
      .getByRole("combobox", { name: "Workspace", exact: true })
      .selectOption(second.workspace.id);
    await expect(
      page.getByRole("link", { name: /Shared collection item/u }),
    ).toBeVisible();
    release.resolve();
    await delivered.promise;
    await expect(page.getByRole("status", { name: "Event count" })).toHaveText(
      "1 of 1 events",
    );
    await expect(
      page.getByRole("link", { name: /Personal collection item/u }),
    ).toHaveCount(0);
    if (testInfo.project.name === "chromium-mobile") {
      await page.getByLabel("Account and workspace").click();
    }
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in$/u);
    await page.getByLabel("Name", { exact: true }).fill("Fresh planner");
    await page.getByLabel("Email").fill(`fresh-${randomUUID()}@example.test`);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/events$/u);
    await expect(
      page.getByRole("link", { name: /collection item/u }),
    ).toHaveCount(0);
    await expect(page.getByRole("status", { name: "Event count" })).toHaveText(
      "0 of 0 events",
    );
    expect(errors).toEqual([]);
  } finally {
    release.resolve();
  }
});
