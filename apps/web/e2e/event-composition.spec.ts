import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { dragComponent } from "./helpers/drag-component";

test("persists composition moves through the authorized versioned layout API", async ({
  page,
  request,
  isMobile,
}) => {
  const email = `composition-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const session = await signedIn.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Summer plans" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const pages = [
    {
      id: randomUUID(),
      name: "Work",
      components: [
        { id: randomUUID(), kind: "todos" },
        { id: randomUUID(), kind: "calendar" },
      ],
    },
    { id: randomUUID(), name: "Day", components: [] },
  ];
  const layoutUrl = `/api/events/${event.id}/layout`;
  const seeded = await request.patch(layoutUrl, {
    headers,
    data: { expectedVersion: 0, pages },
  });
  expect(seeded.status()).toBe(200);
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  await page.goto(`/events/${event.id}`);
  await page
    .getByRole("button", { name: "Arrange layout", exact: true })
    .click();
  const changed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/layout") &&
      response.request().method() === "PATCH",
  );
  if (isMobile)
    await page
      .getByRole("button", { name: "Move Calendar up", exact: true })
      .click();
  else
    await dragComponent(
      page,
      page.getByRole("button", { name: "Drag Calendar", exact: true }),
      page.locator(".event-component-block").first(),
    );
  expect((await changed).status()).toBe(200);
  await expect(page.locator(".event-component-block").first()).toHaveAttribute(
    "aria-label",
    "Calendar component 1",
  );
  await page
    .getByRole("combobox", { name: "Move Calendar to page", exact: true })
    .selectOption({ label: "Day" });
  await expect(
    page.getByRole("heading", { name: "Day", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Move page earlier", exact: true })
    .click();
  const tabs = page
    .getByRole("navigation", { name: "Pages", exact: true })
    .getByRole("button");
  await expect(tabs).toHaveText(["Day", "Work"]);
  await expect(
    page.getByRole("button", { name: "Move page earlier", exact: true }),
  ).toBeDisabled();
  const saved = await (await request.get(layoutUrl, { headers })).json();
  expect(saved).toMatchObject({
    version: 4,
    pages: [
      { id: pages[1]?.id, components: [pages[0]?.components[1]] },
      { id: pages[0]?.id, components: [pages[0]?.components[0]] },
    ],
  });
  expect(
    await (await request.get(`/api/events/${event.id}`, { headers })).json(),
  ).toEqual(event);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Arrange layout", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Day", exact: true }),
  ).toBeVisible();
  const concurrent = await request.patch(layoutUrl, {
    headers,
    data: { expectedVersion: 4, pages: saved.pages },
  });
  expect(concurrent.status()).toBe(200);
  await page
    .getByRole("button", { name: "Move page later", exact: true })
    .click();
  const notice = page
    .getByRole("region", { name: "Event pages", exact: true })
    .getByRole("alert");
  await expect(notice).toContainText("A newer version is available");
  expect(
    (await (await request.get(layoutUrl, { headers })).json()).version,
  ).toBe(5);
  await page
    .getByRole("button", { name: "Refresh latest", exact: true })
    .click();
  await expect(notice).toHaveCount(0);
  await page
    .getByRole("button", { name: "Move page later", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Move page later", exact: true }),
  ).toBeDisabled();
  await expect(tabs).toHaveText(["Work", "Day"]);
  expect(
    (await (await request.get(layoutUrl, { headers })).json()).version,
  ).toBe(6);
});
