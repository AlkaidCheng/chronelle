import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "./fixtures";
import { createRecoveryEvent } from "./helpers/event-draft-recovery";
import {
  exerciseObjectRecovery,
  revisitObjectView,
  planningEditors,
} from "./helpers/object-draft-recovery";

async function signIn(page: Page) {
  const email = `task-recovery-${randomUUID()}@example.test`;
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  return email;
}

for (const kind of ["task", "expense", "reminder"] as const) {
  const { field, view, projection } = planningEditors[kind];
  test(`recovers ${kind} creation and edits through browser navigation`, async ({
    page,
  }, testInfo) => {
    await signIn(page);
    await createRecoveryEvent(page);
    await exerciseObjectRecovery(page, testInfo, kind);
  });

  for (const outcome of ["success", "lost response"] as const)
    test(`settles ${kind} creation ${outcome} after leaving its event`, async ({
      page,
      request,
    }) => {
      const email = await signIn(page);
      const { eventUrl, collectionUrl } = await createRecoveryEvent(page);
      const eventId = new URL(eventUrl).pathname.split("/").at(-1);
      await page.getByRole("button", { name: "Browse event data" }).click();
      await page
        .getByRole("tab", {
          name: view,
          exact: true,
        })
        .click();
      const add = page.getByRole("button", {
        name: `Add ${kind}`,
        exact: true,
      });
      await add.click();
      const name = page.getByLabel(field, {
        exact: true,
      });
      await name.fill("Confirm the lantern delivery");
      if (kind === "expense") {
        await page.getByLabel("Amount", { exact: true }).fill("-12.3400");
        await page.getByLabel("Currency", { exact: true }).fill("CNY");
        await page.getByLabel("Date", { exact: true }).fill("2030-07-03T11:30");
      }
      if (kind === "reminder")
        await page
          .getByLabel("Reminder time", { exact: true })
          .fill("2030-07-03T11:30");
      await revisitObjectView(page);
      await add.click();
      await page
        .getByRole("button", { name: "Resume draft", exact: true })
        .click();
      await expect(name).toHaveValue("Confirm the lantern delivery");
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
      await name.press("ControlOrMeta+Enter");
      await committed.promise;
      const todosUrl = page.url();
      for (let index = 0; index < 3; index++) await page.goBack();
      await expect(page).toHaveURL(collectionUrl);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      for (let index = 0; index < 3; index++) await page.goForward();
      await expect(page).toHaveURL(todosUrl);
      await add.click();
      const saving = page.getByRole("dialog", {
        name: `Saving ${kind}`,
        exact: true,
      });
      await expect(saving).toBeVisible();
      await expect(
        saving.getByRole("button", { name: "Resume draft", exact: true }),
      ).toBeDisabled();
      await expect(
        saving.getByRole("button", { name: "Discard draft", exact: true }),
      ).toBeDisabled();
      const releaseRefresh = Promise.withResolvers<void>();
      const accessEndpoint = `/api/objects/${eventId}/access`;
      const refreshing =
        outcome === "success"
          ? page.waitForRequest((request) =>
              request.url().endsWith(accessEndpoint),
            )
          : undefined;
      if (outcome === "success")
        await page.route(
          `**${accessEndpoint}`,
          async (route) => {
            await releaseRefresh.promise;
            await route.continue();
          },
          { times: 1 },
        );
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
        await expect(name).toHaveValue("Confirm the lantern delivery");
        const retry = page.waitForResponse(
          (response) =>
            response.url().endsWith(endpoint) &&
            response.request().method() === "POST",
        );
        await name.press("ControlOrMeta+Enter");
        const response = await retry;
        expect(response.status()).toBe(201);
        expect(response.request().postDataJSON().commandId).toBe(commandId);
        expect((await response.json()).resource.id).toBe(resourceId);
      }
      try {
        await refreshing;
        await expect(page.getByRole("dialog")).toHaveCount(0);
      } finally {
        releaseRefresh.resolve();
      }
      await expect(page).toHaveURL(todosUrl);
      await expect(
        page
          .getByRole(kind === "task" ? "row" : "article")
          .filter({ hasText: "Confirm the lantern delivery" }),
      ).toHaveCount(1);
      expect(writes).toBe(outcome === "success" ? 1 : 2);
      const signedIn = await request.post("/api/auth/development/sign-in", {
        data: { email, displayName: "Planner" },
      });
      expect(signedIn.status()).toBe(200);
      const session = await signedIn.json();
      const headers = { authorization: `Bearer ${session.accessToken}` };
      const canonical = await request.get(`/api/${kind}s/${resourceId}`, {
        headers,
      });
      expect(canonical.status()).toBe(200);
      expect(await canonical.json()).toMatchObject({
        id: resourceId,
        version: 1,
        permissionScopeId: eventId,
        ...(kind === "task"
          ? { dueAt: null }
          : kind === "reminder"
            ? { status: "pending" }
            : { amount: "-12.3400", currency: "CNY" }),
        displayName: "Confirm the lantern delivery",
      });
      const todos = await request.get(`/api/events/${eventId}/${projection}`, {
        headers,
      });
      expect(todos.status()).toBe(200);
      expect((await todos.json()).items).toHaveLength(1);
      const relations = await request.get(`/api/objects/${eventId}/relations`, {
        headers,
      });
      expect(relations.status()).toBe(200);
      expect(
        (await relations.json()).items.filter(
          (relation: { targetObjectId: string }) =>
            relation.targetObjectId === resourceId,
        ),
      ).toHaveLength(1);
    });
}
