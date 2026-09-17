import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { exerciseCollectionReturn } from "./helpers/collection-return";
import { moveToTrash } from "./helpers/lifecycle";

test("returns to filtered loaded Events without persisting private criteria", async ({
  page,
  request,
}, testInfo) => {
  const email = `collection-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Collection planner" },
  });
  expect(identity.ok()).toBe(true);
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  for (let index = 0; index < 23; index += 1) {
    const created = await request.post("/api/events", {
      headers,
      data: { displayName: `Gathering ${String(index).padStart(2, "0")}` },
    });
    expect(created.status()).toBe(201);
  }
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Collection planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await exerciseCollectionReturn(page, testInfo, "Gathering", 23);

  await page.getByLabel("Filter events by name").fill("Gathering 22");
  const card = page.getByRole("link", { name: /Gathering 22/ });
  await card.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Actions for Gathering 22" }).click();
  await page
    .getByRole("menuitem", { name: "Move to Trash", exact: true })
    .click();
  await moveToTrash(page, page.getByRole("dialog"));
  await page.getByRole("link", { name: /All events/ }).click();
  await expect(
    page.getByText("No matching events", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page.locator(".event-card")).toHaveCount(0);
  await expect(page.getByLabel("Filter events by name")).toHaveValue(
    "Gathering 22",
  );
});
