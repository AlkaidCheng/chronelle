import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { createRecoveryEvent } from "./helpers/event-draft-recovery";
import {
  expectCreatedSchedule,
  prepareScheduleCreation,
} from "./helpers/schedule-creation";
import {
  inspectScheduleRecovery,
  reopenScheduleDraft,
} from "./helpers/schedule-draft-recovery";

for (const outcome of ["success", "lost response"] as const)
  test(`recovers schedule drafts and settles a ${outcome} across navigation @webkit-desktop @webkit-mobile`, async ({
    page,
    request,
  }, testInfo) => {
    const email = `schedule-recovery-${randomUUID()}@example.test`;
    await page.goto("/sign-in/development");
    await page.getByLabel("Name", { exact: true }).fill("Planner");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const { collectionUrl, eventUrl } = await createRecoveryEvent(page);
    const eventId = new URL(eventUrl).pathname.split("/").at(-1);
    await prepareScheduleCreation(page, testInfo);
    await reopenScheduleDraft(page);
    await inspectScheduleRecovery(page, testInfo);

    const endpoint = `/api/events/${eventId}/resources`;
    const committed = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let commandId: string | undefined;
    let resourceId: string | undefined;
    let writes = 0;
    page.on("request", (request) => {
      if (request.url().endsWith(endpoint) && request.method() === "POST")
        writes++;
    });
    await page.route(
      `**${endpoint}`,
      async (route) => {
        commandId = route.request().postDataJSON().commandId;
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        resourceId = (await response.json()).resource.id;
        committed.resolve();
        await release.promise;
        if (outcome === "lost response") await route.abort("failed");
        else await route.fulfill({ response });
      },
      { times: 1 },
    );
    await page
      .getByLabel("Schedule item", { exact: true })
      .press("ControlOrMeta+Enter");
    await committed.promise;

    const calendarUrl = page.url();
    for (let step = 0; step < 3; step++) await page.goBack();
    await expect(page).toHaveURL(collectionUrl);
    await expect(
      page.getByRole("button", { name: "New event", exact: true }),
    ).toBeVisible();
    for (let step = 0; step < 3; step++) await page.goForward();
    await expect(page).toHaveURL(calendarUrl);
    // A save on its way keeps the add row closed to the composer; the row
    // opens the dialog, which shows the save.
    await page
      .getByRole("button", { name: "Add schedule item", exact: true })
      .click();
    const saving = page.getByRole("dialog", {
      name: "Saving event",
      exact: true,
    });
    await expect(saving).toBeVisible();
    await expect(
      saving.getByRole("button", { name: "Resume draft", exact: true }),
    ).toBeDisabled();
    await expect(
      saving.getByRole("button", { name: "Discard draft", exact: true }),
    ).toBeDisabled();
    release.resolve();
    if (outcome === "lost response") {
      const recovery = page.getByRole("dialog", {
        name: "Resume your draft?",
        exact: true,
      });
      await expect(recovery.getByRole("status")).toContainText(
        "could not be confirmed",
      );
      await recovery
        .getByRole("button", { name: "Resume draft", exact: true })
        .click();
      await expect(
        page.getByLabel("Schedule item", { exact: true }),
      ).toHaveValue("Garden arrival");
      const retried = page.waitForResponse(
        (response) =>
          response.url().endsWith(endpoint) &&
          response.request().method() === "POST",
      );
      await page
        .getByLabel("Schedule item", { exact: true })
        .press("ControlOrMeta+Enter");
      const response = await retried;
      expect(response.status()).toBe(201);
      expect(response.request().postDataJSON().commandId).toBe(commandId);
      expect((await response.json()).resource.id).toBe(resourceId);
    }
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(calendarUrl);
    await expectCreatedSchedule(page);
    expect(writes).toBe(outcome === "success" ? 1 : 2);
    const signIn = await request.post("/api/auth/development/sign-in", {
      data: { email, displayName: "Planner" },
    });
    const session = await signIn.json();
    const headers = { authorization: `Bearer ${session.accessToken}` };
    const canonical = await request.get(`/api/events/${resourceId}`, {
      headers,
    });
    expect(canonical.status()).toBe(200);
    expect(await canonical.json()).toMatchObject({
      id: resourceId,
      version: 1,
      permissionScopeId: eventId,
      startsOn: "2030-07-03",
      endsOn: "2030-07-05",
      startsAt: null,
      endsAt: null,
    });
    const calendar = await request.get(`/api/events/${eventId}/calendar`, {
      headers,
    });
    expect((await calendar.json()).items).toHaveLength(1);
  });
