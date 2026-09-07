import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("paginates Trash, recovers an older canonical object and refreshes filters", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const email = `trash-pages-${randomUUID()}@example.test`;
  await page.goto("/sign-in");
  await page.getByLabel("Name").fill("Recovery planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/events$/u);
  const session = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Recovery planner" },
  });
  expect(session.ok()).toBe(true);
  const headers = {
    authorization: `Bearer ${(await session.json()).accessToken}`,
  };
  const ids: string[] = [];
  for (let index = 0; index < 23; index++) {
    const created = await request.post("/api/events", {
      headers,
      data: { displayName: `Deleted event ${index}` },
    });
    expect(created.status()).toBe(201);
    const object = await created.json();
    ids.push(object.id);
    expect(
      (
        await request.delete(`/api/objects/${object.id}?expectedVersion=1`, {
          headers,
        })
      ).status(),
    ).toBe(200);
  }
  await page.goto("/trash");
  await page.getByLabel("Object type").selectOption("event");
  await expect(
    page.getByRole("button", { name: /^Preview recovery for/ }),
  ).toHaveCount(20);
  const original = page.getByRole("button", {
    name: "Preview recovery for Deleted event 0",
    exact: true,
  });
  await expect(original).not.toBeVisible();
  const continuation = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/trash" && url.searchParams.has("cursor");
  });
  await page.getByRole("button", { name: "Load more deleted objects" }).click();
  expect((await continuation).status()).toBe(200);
  await expect(
    page.getByRole("button", { name: /^Preview recovery for/ }),
  ).toHaveCount(23);
  await original.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox").check();
  const recovered = page.waitForResponse((response) =>
    response.url().endsWith(`/objects/${ids[0]}/recover`),
  );
  await dialog.getByRole("button", { name: "Confirm recovery" }).click();
  expect(await (await recovered).json()).toMatchObject({
    id: ids[0],
    version: 3,
    deletedAt: null,
  });
  await expect(dialog.getByRole("status")).toContainText(
    "Recovered as version 3",
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(original).not.toBeVisible();
  await page.getByLabel("Object type").selectOption("document");
  await expect(page.getByText("No recoverable objects")).toBeVisible();
  await page.getByLabel("Object type").selectOption("event");
  await expect(
    page.getByRole("button", { name: /^Preview recovery for/ }),
  ).toHaveCount(20);
  expect(
    (
      await request.delete(`/api/objects/${ids[0]}?expectedVersion=3`, {
        headers,
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "Refresh Trash" }).click();
  await page.getByRole("button", { name: "Load more deleted objects" }).click();
  await expect(original).toBeVisible();
  await page
    .getByRole("button", { name: "Refresh Trash" })
    .evaluate((element) =>
      element.scrollIntoView({ block: "center", behavior: "instant" }),
    );
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("trash-pagination.png") });
  expect(errors).toEqual([]);
});
