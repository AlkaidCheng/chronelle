import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { openEventView } from "./helpers/event-view";

/** The rows of the shown day's sheet, top to bottom, as they read. */
async function sheetRows(page: Page, day: string): Promise<string[]> {
  return page
    .getByRole("region", { name: day })
    .getByRole("listitem")
    .allTextContents();
}

test("adds a trip's itinerary, reads a day sheet with places and gaps, turns days, and copies a day @webkit-desktop @webkit-mobile", async ({
  page,
  request,
  context,
}, testInfo) => {
  const phone = testInfo.project.name.endsWith("-mobile");
  const email = `trip-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Trip planner" },
  });
  expect(identity.status()).toBe(200);
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: {
      displayName: "Kyoto in November",
      startsOn: "2030-11-02",
      endsOn: "2030-11-04",
      timezone: "UTC",
    },
  });
  expect(created.status()).toBe(201);
  const trip = await created.json();
  // Instants in the middle of the UTC day fall on the same calendar day in
  // every zone a runner is likely to use, so the sheet reads the same.
  const add = async (resource: Record<string, unknown>) => {
    const response = await request.post(`/api/events/${trip.id}/resources`, {
      headers,
      data: { commandId: randomUUID(), resource },
    });
    expect(response.status()).toBe(201);
  };
  await add({
    objectType: "event",
    displayName: "Kyoto, day 2",
    startsOn: "2030-11-02",
    endsOn: "2030-11-04",
  });
  await add({
    objectType: "event",
    displayName: "Fushimi Inari, the lower loop",
    startsAt: "2030-11-03T10:00:00.000Z",
    endsAt: "2030-11-03T12:00:00.000Z",
    location: "Fushimi Inari Taisha, main gate",
  });
  await add({
    objectType: "event",
    displayName: "Breakfast at the ryokan",
    startsAt: "2030-11-03T08:30:00.000Z",
    endsAt: "2030-11-03T09:30:00.000Z",
    location: "Yoshida-sanso, dining room",
  });
  await add({
    objectType: "event",
    displayName: "Tea ceremony",
    startsAt: "2030-11-03T14:00:00.000Z",
    endsAt: "2030-11-03T16:00:00.000Z",
    location: "Camellia Flower, Ninenzaka",
  });
  await add({
    objectType: "event",
    displayName: "Yasaka shrine at dusk",
    startsOn: "2030-11-03",
  });
  await add({
    objectType: "task",
    displayName: "Confirm dinner headcount",
    dueOn: "2030-11-03",
  });

  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Trip planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
  await page.goto(`/events/${trip.id}?view=todos`);

  // The gallery offers the Itinerary as a card of its own.
  await page.getByRole("button", { name: "Add a view", exact: true }).click();
  const gallery = page.getByRole("dialog", {
    name: "Add to Kyoto in November",
  });
  const card = gallery.getByRole("button", { name: /^Itinerary/ });
  await expect(card).toContainText(
    "One day at a time: the running order with times, places and the gaps between.",
  );
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await gallery.getByRole("button", { name: "Done" }).click();

  // The sheet opens on the trip's first day; the second holds the running
  // order. A phone picks the view from its select.
  await openEventView(page, "Itinerary");
  const sheet = page.getByRole("tabpanel", { name: "Itinerary" });
  await expect(page).toHaveURL(/view=itinerary/u);
  await expect(page.getByRole("heading", { name: "Itinerary" })).toBeVisible();
  await expect(page.getByText("Day 1 of 3")).toBeVisible();
  await expect(page.getByRole("region", { name: "Sat, Nov 2" })).toContainText(
    "Kyoto, day 2",
  );
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page.getByText("Day 2 of 3")).toBeVisible();
  expect(await sheetRows(page, "Sun, Nov 3")).toEqual([
    "Kyoto, day 2",
    expect.stringContaining(
      "Breakfast at the ryokanYoshida-sanso, dining room",
    ),
    "30 min free",
    expect.stringContaining(
      "Fushimi Inari, the lower loopFushimi Inari Taisha, main gate",
    ),
    "2 h free",
    expect.stringContaining("Tea ceremonyCamellia Flower, Ninenzaka"),
    "Confirm dinner headcount",
    expect.stringMatching(/Yasaka shrine at dusk$/u),
  ]);
  await expect(page.getByRole("heading", { name: "Due today" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Not yet timed" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("day-sheet.png"),
    fullPage: true,
  });

  // On a phone the duration folds into the time column and a swipe turns
  // the day; on a desktop the duration has its own column.
  const duration = page
    .getByRole("region", { name: "Sun, Nov 3" })
    .locator(".day-sheet-duration")
    .first();
  if (phone) {
    await expect(duration).toBeHidden();
    await expect(
      page.locator(".day-sheet-duration-folded").first(),
    ).toBeVisible();
    await page.locator(".day-sheet-pages").evaluate((element) => {
      const at = (type: string, x: number) =>
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            clientX: x,
            clientY: 300,
            pointerId: 42,
            pointerType: "touch",
          }),
        );
      at("pointerdown", 300);
      at("pointerup", 120);
    });
    await expect(page.getByText("Day 3 of 3")).toBeVisible();
    await page.getByRole("button", { name: "Previous day" }).click();
    await expect(page.getByText("Day 2 of 3")).toBeVisible();
  } else {
    await expect(duration).toHaveText("1 h");
  }

  // Copy day puts the shown day on the clipboard as text. Chromium writes
  // to the clipboard only with the permission granted; WebKit needs none
  // but does not let the test read it back.
  const chromium = testInfo.project.name.startsWith("chromium");
  if (chromium)
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy day" }).click();
  await expect(sheet.getByRole("status")).toHaveText("Day copied.");
  if (chromium) {
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.split("\n")).toEqual([
      "Sun, Nov 3",
      "Kyoto, day 2",
      expect.stringMatching(
        /^[\d:APM ]+-[\d:APM ]+ {2}Breakfast at the ryokan - Yoshida-sanso, dining room$/u,
      ),
      expect.stringMatching(
        /^[\d:APM ]+-[\d:APM ]+ {2}Fushimi Inari, the lower loop - Fushimi Inari Taisha, main gate$/u,
      ),
      expect.stringMatching(
        /^[\d:APM ]+-[\d:APM ]+ {2}Tea ceremony - Camellia Flower, Ninenzaka$/u,
      ),
      "-  Yasaka shrine at dusk",
    ]);
  }

  // All days stacks every sheet under its own day line.
  await page.getByRole("button", { name: "Layout: Day" }).click();
  await page.getByRole("menuitemradio", { name: "All days" }).click();
  await expect(page.getByRole("heading", { level: 3 })).toHaveText([
    "Sat, Nov 2",
    "Sun, Nov 3",
    "Mon, Nov 4",
  ]);
  await expect(
    page.getByRole("button", { name: "Layout: All days" }),
  ).toBeVisible();

  // Add schedule item from the sheet is the Calendar's dialog, with the Place.
  await page.getByRole("button", { name: "Add schedule item" }).click();
  const dialog = page.getByRole("dialog", { name: "Add schedule item" });
  await expect(
    dialog.getByRole("button", { name: /^Add a place/ }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});
