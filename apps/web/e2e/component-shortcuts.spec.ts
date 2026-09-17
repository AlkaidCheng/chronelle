import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { exerciseComponentShortcuts } from "./helpers/component-shortcuts";

test("inserts through the canonical layout API and synchronizes shortcut preferences @webkit-desktop @webkit-mobile", async ({
  page,
  request,
  context,
}, testInfo) => {
  const email = `component-shortcuts-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const session = await signedIn.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Keyboard plans" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("link", { name: /Keyboard plans/ }).click();
  await exerciseComponentShortcuts(page, testInfo);
  const layout = await (
    await request.get(`/api/events/${event.id}/layout`, { headers })
  ).json();
  expect(layout).toMatchObject({
    version: 2,
    pages: [{ name: "Shortcut plans", components: [{ kind: "files" }] }],
  });
  expect(layout.pages).toHaveLength(1);
  expect(layout.pages[0].components).toHaveLength(1);
  expect(
    await (await request.get(`/api/events/${event.id}`, { headers })).json(),
  ).toEqual(event);
  const other = await context.newPage();
  await other.goto("/sign-in/development");
  await other.evaluate(() =>
    localStorage.setItem("chronelle.component-shortcut", "disabled"),
  );
  const add = page.getByRole("button", { name: "Add component", exact: true });
  await expect(add).not.toHaveAttribute("aria-keyshortcuts");
  await page.reload();
  await expect(add).not.toHaveAttribute("aria-keyshortcuts");
  await other.evaluate(() =>
    localStorage.removeItem("chronelle.component-shortcut"),
  );
  await expect(add).toHaveAttribute("aria-keyshortcuts", "/");
  await other.close();
});
