import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import {
  createRecoveryEvent,
  exerciseEventDraftRecovery,
} from "./helpers/event-draft-recovery";

async function signIn(page: Page) {
  const email = `recovery-${randomUUID()}@example.test`;
  await page.goto("/sign-in");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  return email;
}

test("recovers Event drafts through native Back and Forward", async ({
  page,
  request,
}, testInfo) => {
  const email = await signIn(page);
  await exerciseEventDraftRecovery(page, testInfo);
  const response = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(response.status()).toBe(200);
  const session = await response.json();
  const events = await request.get("/api/events", {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  expect(events.status()).toBe(200);
  expect((await events.json()).items).toEqual([
    expect.objectContaining({
      displayName: "Recovered garden evening",
      version: 2,
      startsOn: "2030-07-03",
      endsOn: "2030-07-12",
      startsAt: null,
    }),
  ]);
});

for (const kind of ["create", "edit"] as const)
  test(`settles a pending ${kind} save across native navigation`, async ({
    page,
  }) => {
    await signIn(page);
    const { collectionUrl, eventUrl } = await createRecoveryEvent(page);
    if (kind === "create") {
      await page.goBack();
      await expect(page).toHaveURL(collectionUrl);
    }
    const open = () =>
      page
        .getByRole("button", {
          name: kind === "create" ? "New event" : "Edit event",
          exact: true,
        })
        .click();
    await open();
    await page
      .getByLabel(kind === "create" ? "Event name" : "Name", { exact: true })
      .fill("Saved while away");
    const release = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    let writes = 0;
    await page.route("**/api/**", async (route) => {
      if (route.request().method() === (kind === "create" ? "POST" : "PATCH")) {
        writes++;
        started.resolve();
        await release.promise;
      }
      await route.continue();
    });
    await page
      .getByRole("button", {
        name: kind === "create" ? "Create event" : "Save event",
        exact: true,
      })
      .click();
    await started.promise;
    if (kind === "create") {
      await page.goForward();
      await expect(page).toHaveURL(eventUrl);
      await page.goBack();
      await expect(page).toHaveURL(collectionUrl);
    } else {
      await page.goBack();
      await expect(page).toHaveURL(collectionUrl);
      await page.goForward();
      await expect(page).toHaveURL(eventUrl);
    }
    await open();
    const pending = page.getByRole("dialog", {
      name: "Saving event",
      exact: true,
    });
    await expect(pending).toBeVisible();
    await expect(
      pending.getByRole("button", { name: "Resume draft", exact: true }),
    ).toBeDisabled();
    await expect(
      pending.getByRole("button", { name: "Discard draft", exact: true }),
    ).toBeDisabled();
    const currentUrl = page.url();
    release.resolve();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(currentUrl);
    expect(writes).toBe(1);
    await open();
    await expect(
      page.getByLabel(kind === "create" ? "Event name" : "Name", {
        exact: true,
      }),
    ).toHaveValue(kind === "create" ? "" : "Saved while away");
  });
