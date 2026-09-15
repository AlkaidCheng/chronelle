import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";

test("pages Events and filters the full collection at responsive widths", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const email = `event-pages-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Event planner" },
  });
  expect(identity.ok()).toBe(true);
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const ids: string[] = [];
  for (let index = 0; index < 23; index += 1) {
    const response = await request.post("/api/events", {
      headers,
      data: { displayName: `Gathering ${String(index).padStart(2, "0")}` },
    });
    expect(response.status()).toBe(201);
    ids.push((await response.json()).id);
  }
  await page.goto("/sign-in/development");
  await page.getByLabel("Name").fill("Event planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  const count = page.getByRole("status", { name: "Event count" });
  await expect(count).toHaveText("20 events loaded");
  await expect(page.getByRole("link", { name: /Gathering 22/ })).toHaveCount(0);
  await page.getByLabel("Filter events by name").fill("Gathering 22");
  await expect(count).toHaveText("1 event loaded");
  await expect(
    page.getByRole("link", { name: /Gathering 22/ }),
  ).toHaveAttribute("href", `/events/${ids[22]}`);
  await page.getByLabel("Filter events by name").fill("");
  await expect(count).toHaveText("20 events loaded");
  await page.getByRole("button", { name: "Load more events" }).focus();
  await page.keyboard.press("Enter");
  await expect(count).toHaveText("23 events loaded");
  await expect(
    page.getByRole("button", { name: "Load more events" }),
  ).toHaveCount(0);
  const links = await page
    .locator(".event-card")
    .evaluateAll((cards) => cards.map((card) => card.getAttribute("href")));
  expect(new Set(links).size).toBe(23);
  await page.getByRole("button", { name: "Refresh events" }).click();
  await expect(count).toHaveText("20 events loaded");
  await page.getByRole("button", { name: "List view" }).click();
  await page.getByLabel("Sort events").selectOption("updated");
  expect(
    await page
      .getByLabel("Sort events")
      .evaluate((select) => select.getBoundingClientRect().width),
  ).toBeGreaterThanOrEqual(170);
  await expect(page.locator(".event-card").first()).toHaveAttribute(
    "href",
    `/events/${ids[22]}`,
  );
  const updated = await request.patch(`/api/events/${ids[0]}`, {
    headers,
    data: { expectedVersion: 1, displayName: "Revised gathering" },
  });
  expect(updated.status()).toBe(200);
  await page.getByRole("button", { name: "Refresh events" }).click();
  await expect(page.locator(".event-card").first()).toHaveAttribute(
    "href",
    `/events/${ids[0]}`,
  );
  await expect(page.locator(".event-card").first()).toContainText(
    "Revised gathering",
  );
  await page.screenshot({ path: testInfo.outputPath("event-pages.png") });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: /Revised gathering/ }).click();
  await expect(
    page.getByRole("heading", { name: "Revised gathering", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
