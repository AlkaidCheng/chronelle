import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { openEventView } from "./helpers/event-view";
import { chooseRowAction } from "./helpers/row-menu";

test("edits a task row in place: chips, Save, Cancel, a stale save, and the row menu's Edit @webkit-desktop", async ({
  page,
  request,
}, testInfo) => {
  const email = `inline-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const headers = {
    authorization: `Bearer ${(await signedIn.json()).accessToken}`,
  };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Garden evening" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const added = await request.post(`/api/events/${event.id}/resources`, {
    headers,
    data: {
      commandId: randomUUID(),
      resource: { objectType: "task", displayName: "Book the ryokan" },
    },
  });
  expect(added.status()).toBe(201);
  const task = (await added.json()).resource;
  const labelled = await request.post("/api/labels", {
    headers,
    data: { name: "Travel" },
  });
  expect(labelled.status()).toBe(201);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("link", { name: /Garden evening/ }).click();
  await openEventView(page, "To-dos");
  const row = page.getByRole("row", { name: /Book the ryokan/ });
  await expect(row).toBeVisible();

  // Pressing the row's name opens it in place, prefilled and focused.
  await row.getByRole("button", { name: "Edit Book the ryokan" }).click();
  const composer = page.getByRole("form", { name: "Edit Book the ryokan" });
  const name = composer.getByLabel("Task name", { exact: true });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("Book the ryokan");
  // The row's button gives way to the composer in its place.
  await expect(
    page.getByRole("button", { name: "Edit Book the ryokan" }),
  ).toHaveCount(0);
  await expect(composer).toBeVisible();

  // The Due chip opens the date panel; a shortcut sets the day and the chip
  // reads it. Assignee lists the people with Assign to me; Labels is the
  // checklist; a set chip clears.
  await composer.getByRole("button", { name: "Due", exact: true }).click();
  await page.getByRole("button", { name: /^Tomorrow/ }).click();
  await expect(
    composer.getByRole("button", { name: /^Due: .*\(tomorrow\)$/ }),
  ).toBeVisible();
  await composer.getByRole("button", { name: "Assignee", exact: true }).click();
  const assignee = page.getByRole("dialog", { name: "Assignee", exact: true });
  await assignee
    .getByRole("button", { name: "Assign to me", exact: true })
    .click();
  await expect(
    composer.getByRole("button", { name: "Assignee: Planner", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(assignee).toHaveCount(0);
  await expect(
    composer.getByRole("button", { name: "Assignee: Planner", exact: true }),
  ).toBeFocused();
  await composer.getByRole("button", { name: "Labels", exact: true }).click();
  const labels = page.getByRole("dialog", { name: "Labels", exact: true });
  await labels.getByRole("checkbox", { name: "Travel" }).check();
  await expect(
    composer.getByRole("button", { name: "Labels: Travel", exact: true }),
  ).toBeVisible();
  // The clear empties the field and leaves the checklist open for another
  // choice; Escape from the checklist closes it and returns to the chip.
  await composer.getByRole("button", { name: "Clear Labels" }).click();
  await expect(
    composer.getByRole("button", { name: "Labels", exact: true }),
  ).toBeVisible();
  const travel = labels.getByRole("checkbox", { name: "Travel" });
  await expect(travel).not.toBeChecked();
  await travel.focus();
  await page.keyboard.press("Escape");
  await expect(labels).toHaveCount(0);
  await expect(
    composer.getByRole("button", { name: "Labels", exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("row-composer.png") });

  // Save writes one update carrying the row's version (a content command,
  // so it can be undone); the row reads it.
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/commands") &&
      response.request().method() === "POST",
  );
  await composer.getByRole("button", { name: "Save", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(composer).toHaveCount(0);
  await expect(row).toBeVisible();
  await expect(row.getByText("Assigned to Planner")).toBeAttached();
  const canonical = await request.get(`/api/tasks/${task.id}`, { headers });
  expect(await canonical.json()).toMatchObject({
    version: task.version + 1,
    labelIds: [],
  });
  expect((await canonical.json()).assigneeId).not.toBeNull();

  // Pressing again and Cancel changes nothing; Escape closes too.
  await row.getByRole("button", { name: "Edit Book the ryokan" }).click();
  await name.fill("Book the ryokan for two");
  await composer.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(composer).toHaveCount(0);
  await expect(row).toContainText("Book the ryokan");
  await expect(row).not.toContainText("for two");
  await row.getByRole("button", { name: "Edit Book the ryokan" }).click();
  await expect(name).toHaveValue("Book the ryokan");
  await page.keyboard.press("Escape");
  await expect(composer).toHaveCount(0);

  // The row menu's Edit opens the composer as well; a save refused as
  // stale (the task edited elsewhere) shows the comparison, and Take
  // theirs loads the newest version.
  await chooseRowAction(page, row, "Edit");
  await expect(name).toBeFocused();
  await name.fill("Book the ryokan early");
  const elsewhere = await request.patch(`/api/tasks/${task.id}`, {
    headers,
    data: { expectedVersion: task.version + 1, location: "Kyoto" },
  });
  expect(elsewhere.status()).toBe(200);
  await composer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    composer.getByText("Saved elsewhere while you edited"),
  ).toBeVisible();
  await composer
    .getByRole("button", { name: "Take theirs", exact: true })
    .click();
  await expect(name).toHaveValue("Book the ryokan");
  await expect(
    composer.getByRole("button", { name: "Location: Kyoto", exact: true }),
  ).toBeVisible();
  await name.press("Escape");
  await expect(composer).toHaveCount(0);
  await expect(row.getByText("Kyoto")).toBeVisible();
  expect(errors).toEqual([]);
});

test("asks before another row opens over unsaved changes, and keeps a row's draft across a visit elsewhere @webkit-desktop", async ({
  page,
  request,
}) => {
  const email = `inline-ask-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const headers = {
    authorization: `Bearer ${(await signedIn.json()).accessToken}`,
  };
  for (const displayName of ["Pack the lanterns", "Order the flowers"]) {
    const added = await request.post("/api/tasks", {
      headers,
      data: { displayName },
    });
    expect(added.status()).toBe(201);
  }
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
  await page.goto("/tasks");
  const lanterns = page.getByRole("row", { name: /Pack the lanterns/ });
  const flowers = page.getByRole("row", { name: /Order the flowers/ });
  await expect(lanterns).toBeVisible();
  await lanterns
    .getByRole("button", { name: "Edit Pack the lanterns" })
    .click();
  const composer = page.getByRole("form", { name: "Edit Pack the lanterns" });
  const name = composer.getByLabel("Task name", { exact: true });
  await name.fill("Pack the lanterns and candles");
  await flowers.getByRole("button", { name: "Edit Order the flowers" }).click();
  await expect(composer).toContainText(
    "This row has unsaved changes. Discard them?",
  );
  const keep = composer.getByRole("button", { name: "Keep editing" });
  await expect(keep).toBeFocused();
  await keep.click();
  await expect(name).toHaveValue("Pack the lanterns and candles");
  await expect(
    page.getByRole("form", { name: "Edit Order the flowers" }),
  ).toHaveCount(0);

  // Leaving the page and coming back finds the row open with the text.
  await page.getByRole("link", { name: "Events", exact: true }).first().click();
  await expect(page).toHaveURL(/\/events$/u);
  await page.goBack();
  await expect(page).toHaveURL(/\/tasks$/u);
  await expect(name).toHaveValue("Pack the lanterns and candles");

  // Discard lets the other row open, the first one unchanged.
  await flowers.getByRole("button", { name: "Edit Order the flowers" }).click();
  await composer.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(composer).toHaveCount(0);
  await expect(
    page
      .getByRole("form", { name: "Edit Order the flowers" })
      .getByLabel("Task name", { exact: true }),
  ).toBeFocused();
  await expect(lanterns).toContainText("Pack the lanterns");
  await expect(lanterns).not.toContainText("candles");
});
