import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";

test("shares an event with the people the workspace knows", async ({
  page,
  request,
}) => {
  const ownerEmail = `owner-${randomUUID()}@example.test`;
  const readerEmail = `reader-${randomUUID()}@example.test`;
  const owner = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email: ownerEmail, displayName: "Planner" },
    })
  ).json();
  const reader = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email: readerEmail, displayName: "Reader" },
    })
  ).json();
  const headers = { authorization: `Bearer ${owner.accessToken}` };
  const event = await (
    await request.post("/api/events", {
      headers,
      data: { displayName: "Reading circle" },
    })
  ).json();
  // One person reaches an account through their email; one reaches none.
  for (const data of [
    { displayName: "Reader Person", email: readerEmail.toUpperCase() },
    { displayName: "No Account" },
  ])
    expect(
      (await request.post("/api/persons", { headers, data })).status(),
    ).toBe(201);

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("link", { name: /Reading circle/ }).click();
  await page.getByRole("button", { name: "Share event", exact: true }).click();
  const list = page.getByRole("list", { name: "Share with people" });
  await expect(list.getByRole("checkbox")).toHaveCount(1);
  await expect(list.getByText(readerEmail.toUpperCase())).toBeVisible();
  const shareButton = page.getByRole("button", { name: /^Share with \d/ });
  await expect(shareButton).toBeDisabled();
  await list.getByRole("checkbox", { name: /Reader Person/ }).check();
  await expect(shareButton).toHaveText("Share with 1 person");
  await shareButton.click();
  await expect(list.getByText("Shared as viewer")).toBeVisible();
  await expect(
    page.locator(".share-list").getByText("Reader", { exact: true }),
  ).toBeVisible();
  await expect(
    list.getByRole("checkbox", { name: /Reader Person/ }),
  ).not.toBeChecked();
  const grants = await (
    await request.get(`/api/objects/${event.id}/shares`, { headers })
  ).json();
  expect(grants.items).toMatchObject([
    { principal: { id: reader.user.id, email: readerEmail }, role: "viewer" },
  ]);
  expect(errors).toEqual([]);
});
