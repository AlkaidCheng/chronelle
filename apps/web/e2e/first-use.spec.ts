import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import {
  activateWithKeyboard,
  createFirstPlan,
  tabTo,
} from "./helpers/first-use";
import { expectHorizontalReflow } from "./helpers/page-navigation";

test("starts an undated plan with the keyboard and reopens it after recovery", async ({
  page,
  request,
}, testInfo) => {
  const email = `first-use-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Event planner" },
  });
  expect(identity.ok()).toBe(true);
  const headers = {
    authorization: `Bearer ${(await identity.json()).accessToken}`,
  };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (testInfo.project.name.endsWith("mobile"))
    await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Event planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await createFirstPlan(page, testInfo);
  const eventId = new URL(page.url()).pathname.split("/").at(-1);
  const layout = await request.get(`/api/events/${eventId}/layout`, {
    headers,
  });
  expect(layout.ok()).toBe(true);
  const savedLayout = await layout.json();
  const tasks = await request.get(`/api/events/${eventId}/todos`, { headers });
  expect(tasks.ok()).toBe(true);
  const savedTasks = await tasks.json();

  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "Actions for A first gathering" }),
  );
  const actions = page.getByRole("dialog");
  await activateWithKeyboard(
    page,
    actions.getByRole("button", { name: "Move to Trash", exact: true }),
  );
  await tabTo(page, actions.getByRole("checkbox"));
  await page.keyboard.press("Space");
  await activateWithKeyboard(
    page,
    actions.getByRole("button", { name: "Confirm move to Trash" }),
  );
  await expect(actions.getByRole("status")).toHaveText(
    "Moved to Trash. No related objects were deleted.",
  );
  await activateWithKeyboard(
    page,
    actions.getByRole("link", { name: "Open Trash" }),
  );
  await tabTo(page, page.getByLabel("Object type"));
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "No recoverable objects of this type" }),
  ).toBeVisible();
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "Clear type filter" }),
  );
  await activateWithKeyboard(
    page,
    page.getByRole("button", {
      name: "Preview recovery for A first gathering",
    }),
  );
  const recovery = page.getByRole("dialog", { name: "Recovery preview" });
  await expect(
    recovery.getByRole("link", { name: "Open recovered event" }),
  ).toHaveCount(0);
  await tabTo(page, recovery.getByRole("checkbox"));
  await page.keyboard.press("Space");
  await activateWithKeyboard(
    page,
    recovery.getByRole("button", { name: "Confirm recovery" }),
  );
  await expect(recovery.getByRole("status")).toContainText(
    "Recovered as version",
  );
  expect(
    await recovery
      .getByRole("button", { name: "Close", exact: true })
      .evaluate((button) => {
        const text = document.createRange();
        text.selectNodeContents(button);
        return text.getClientRects().length;
      }),
    "The recovery Close label stays on one line",
  ).toBe(1);
  await expectHorizontalReflow(page);
  await page.screenshot({
    path: testInfo.outputPath("first-event-recovery.png"),
  });
  const open = recovery.getByRole("link", { name: "Open recovered event" });
  await expect(open).toHaveAttribute("href", `/events/${eventId}`);
  await activateWithKeyboard(page, open);
  await expect(recovery).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: "Invite a friend" }),
  ).toBeVisible();
  await expectHorizontalReflow(page);
  const restoredLayout = await request.get(`/api/events/${eventId}/layout`, {
    headers,
  });
  expect(await restoredLayout.json()).toEqual(savedLayout);
  const restoredTasks = await request.get(`/api/events/${eventId}/todos`, {
    headers,
  });
  expect(await restoredTasks.json()).toEqual(savedTasks);
  await activateWithKeyboard(
    page,
    page.getByRole("link", { name: "All events", exact: true }),
  );
  await expect(
    page.getByRole("link", { name: /A first gathering/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
