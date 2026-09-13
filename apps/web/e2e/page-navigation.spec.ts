import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import {
  exercisePageNavigation,
  expectHorizontalReflow,
  navigationPageNames,
} from "./helpers/page-navigation";

test("reports document and element widths when content overflows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.setContent(
    '<meta name="viewport" content="width=device-width, initial-scale=1"><style>body { margin: 0 }</style><div class="wide" style="width: 640px; height: 44px"></div>',
  );
  await expect(expectHorizontalReflow(page)).rejects.toThrow(
    /"viewport":320,"documentWidth":640,"overflowing":\[\{"tag":"DIV","class":"wide"/,
  );
  await page.locator(".wide").evaluate((element) => {
    (element as HTMLElement).style.width = "100%";
  });
  await expectHorizontalReflow(page);
});

test("keeps named pages bookmarkable through views and workspace navigation", async ({
  page,
  request,
}, testInfo) => {
  const email = `navigation-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(identity.ok()).toBe(true);
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: {
      displayName:
        "A summer of quiet gardens, shared meals, and long conversations with everyone we love",
    },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const pages = navigationPageNames.map((name) => ({
    id: randomUUID(),
    name,
    components: [],
  }));
  const layoutUrl = `/api/events/${event.id}/layout`;
  expect(
    (
      await request.patch(layoutUrl, {
        headers,
        data: { expectedVersion: 0, pages },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/sign-in");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  await page.goto(`/events/${event.id}`);
  await exercisePageNavigation(page, testInfo);
  expect(
    (await (await request.get(layoutUrl, { headers })).json()).version,
  ).toBe(1);
  expect(
    await (await request.get(`/api/events/${event.id}`, { headers })).json(),
  ).toEqual(event);
  expect(
    (
      await request.patch(layoutUrl, {
        headers,
        data: { expectedVersion: 1, pages: pages.slice(0, 2) },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByText(/The requested page is unavailable/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: navigationPageNames[0], exact: true }),
  ).toBeVisible();
});
