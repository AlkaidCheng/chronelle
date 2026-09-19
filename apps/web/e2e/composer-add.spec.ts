import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { openEventView } from "./helpers/event-view";

test("adds tasks from the add row's composer: a name alone, then chips for the due and the location @webkit-desktop @webkit-mobile", async ({
  page,
  request,
}, testInfo) => {
  const email = `composer-add-${randomUUID()}@example.test`;
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
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const mobile = testInfo.project.name.endsWith("mobile");

  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("link", { name: /Garden evening/ }).click();
  await openEventView(page, "To-dos");

  // The add row opens the composer empty with the name focused; a name
  // and Enter add a task and keep the composer open for the next.
  await page
    .getByRole("button", { name: "Add a task to the list", exact: true })
    .click();
  const composer = page.getByRole("form", { name: "New task", exact: true });
  const name = composer.getByLabel("Task name", { exact: true });
  await expect(name).toBeFocused();
  await expect(
    composer.getByRole("button", { name: "Add task", exact: true }),
  ).toBeDisabled();
  await name.fill("Book the ryokan");
  await name.press("Enter");
  await expect(
    page.getByRole("row", { name: /Book the ryokan/ }),
  ).toBeVisible();
  await expect(name).toHaveValue("");
  await expect(name).toBeFocused();

  // The second task takes a due day from the chip's panel and a location
  // from its field; the chips read what is set, and clear.
  await name.fill("Confirm the garden venue");
  await composer.getByRole("button", { name: "Due", exact: true }).click();
  const typed = page.getByLabel("Type a date", { exact: true });
  await typed.fill("2030-11-03");
  await typed.press("Escape");
  await expect(typed).toHaveCount(0);
  await expect(
    composer.getByRole("button", { name: "Due: Nov 3, 2030", exact: true }),
  ).toBeVisible();
  await composer.getByRole("button", { name: "Location", exact: true }).click();
  const location = page.getByRole("dialog", { name: "Location", exact: true });
  await expect(location).toBeVisible();
  if (mobile) {
    // On a phone the chip's control is a sheet from the bottom.
    const box = await location.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box && viewport) {
      expect(Math.round(box.x)).toBe(0);
      expect(Math.round(box.width)).toBe(viewport.width);
      expect(Math.round(box.y + box.height)).toBe(viewport.height);
    }
  }
  await page.screenshot({ path: testInfo.outputPath("add-composer.png") });
  await location.getByLabel("Location", { exact: true }).fill("The garden");
  await location.getByLabel("Location", { exact: true }).press("Enter");
  await expect(location).toHaveCount(0);
  await expect(
    composer.getByRole("button", { name: "Location: The garden", exact: true }),
  ).toBeFocused();
  const creation = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/events/${event.id}/resources`) &&
      response.request().method() === "POST",
  );
  await composer.getByRole("button", { name: "Add task", exact: true }).click();
  expect((await creation).status()).toBe(201);
  const row = page.getByRole("row", { name: /Confirm the garden venue/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Nov 3, 2030");
  await expect(row.getByText("At The garden")).toBeAttached();
  await expect(name).toHaveValue("");
  await expect(
    composer.getByRole("button", { name: "Due", exact: true }),
  ).toBeVisible();

  // Escape closes the composer; the add row is back.
  await name.press("Escape");
  await expect(composer).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add a task to the list", exact: true }),
  ).toBeVisible();
  const todos = await request.get(`/api/events/${event.id}/todos`, { headers });
  expect(
    (await todos.json()).items.map(
      (item: {
        displayName: string;
        dueOn: string | null;
        location: string | null;
      }) => [item.displayName, item.dueOn, item.location],
    ),
  ).toEqual(
    expect.arrayContaining([
      ["Book the ryokan", null, null],
      ["Confirm the garden venue", "2030-11-03", "The garden"],
    ]),
  );
  expect(errors).toEqual([]);
});
