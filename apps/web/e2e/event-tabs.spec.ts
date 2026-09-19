import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";

/** The tabs on the strip, pages and views, as they read left to right. */
async function stripTabs(page: Page): Promise<string[]> {
  return page
    .locator(".event-strip [data-tab-key]:not([hidden])")
    .allTextContents();
}

/** Every view tab in order, folded ones included. */
async function viewTabs(page: Page): Promise<string[]> {
  return page.getByRole("tab", { includeHidden: true }).allTextContents();
}

test("keeps the account's tabs for an event through the gallery, Manage tabs, the fold chip and a reload @webkit-desktop @webkit-mobile", async ({
  page,
  request,
}, testInfo) => {
  const phone = testInfo.project.name.endsWith("-mobile");
  const email = `tabs-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Tab keeper" },
  });
  expect(identity.status()).toBe(200);
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Harvest supper", timezone: "UTC" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();

  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Tab keeper");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
  await page.goto(`/events/${event.id}?view=todos`);
  await expect(
    page.getByRole("tab", { name: "To-dos", exact: true }),
  ).toHaveAttribute("aria-selected", "true");

  // The gallery: a card is a switch. Timeline leaves the strip and comes
  // back at its end; the dialog stays open throughout.
  await page.getByRole("button", { name: "Add a view", exact: true }).click();
  const gallery = page.getByRole("dialog", { name: "Add to Harvest supper" });
  await expect(gallery).toBeVisible();
  const timelineCard = gallery.getByRole("button", { name: /^Timeline/ });
  await expect(timelineCard).toHaveAttribute("aria-pressed", "true");
  await timelineCard.click();
  await expect(timelineCard).toHaveAttribute("aria-pressed", "false");
  await expect(gallery).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Timeline", includeHidden: true }),
  ).toHaveCount(0);
  await timelineCard.click();
  await expect(timelineCard).toHaveAttribute("aria-pressed", "true");
  const filesCard = gallery.getByRole("button", { name: /^Files/ });
  await filesCard.click();
  await expect(filesCard).toHaveAttribute("aria-pressed", "false");
  await expect(
    gallery.getByRole("button", { name: /^To-dos/ }),
  ).toHaveAttribute("aria-disabled", "true");
  await page.screenshot({ path: testInfo.outputPath("gallery.png") });
  await gallery.getByRole("button", { name: "Done", exact: true }).click();
  await expect(gallery).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add a view", exact: true }),
  ).toBeFocused();
  expect(await viewTabs(page)).toEqual([
    "Overview",
    "To-dos",
    "Calendar",
    "Expenses",
    "Reminders",
    "People",
    "Sharing",
    "Removed links",
    "Timeline",
  ]);

  // Manage tabs from the More menu: the eye hides Expenses, the grip's
  // arrow keys move Calendar down two places, and Overview has no cross.
  await page
    .getByRole("button", { name: "Actions for Harvest supper", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Manage tabs", exact: true })
    .click();
  const manage = page.getByRole("dialog", { name: "Manage tabs" });
  await expect(manage).toBeVisible();
  await expect(
    manage.getByRole("button", { name: "Remove Calendar from the event" }),
  ).toBeVisible();
  await expect(
    manage.getByRole("button", { name: /^Remove Overview/ }),
  ).toHaveCount(0);
  await manage
    .getByRole("button", { name: "Hide Expenses", exact: true })
    .click();
  await expect(
    manage.getByRole("button", { name: "Show Expenses", exact: true }),
  ).toBeVisible();
  await manage
    .getByRole("button", { name: "Move Calendar", exact: true })
    .focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(
    manage.getByRole("button", { name: "Move Calendar", exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("manage-tabs.png") });
  await manage.getByRole("button", { name: "Done", exact: true }).click();
  await expect(manage).toHaveCount(0);
  expect(await viewTabs(page)).toEqual([
    "Overview",
    "To-dos",
    "Reminders",
    "Calendar",
    "People",
    "Sharing",
    "Removed links",
    "Timeline",
  ]);

  // The arrangement is the account's: a reload shows it again, and the
  // session carries it for this event alone.
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "To-dos", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(await viewTabs(page)).toEqual([
    "Overview",
    "To-dos",
    "Reminders",
    "Calendar",
    "People",
    "Sharing",
    "Removed links",
    "Timeline",
  ]);
  const me = await request.get("/api/auth/session", { headers });
  expect((await me.json()).user.eventTabs).toEqual({
    [event.id]: {
      order: [
        "overview",
        "todos",
        "expenses",
        "reminders",
        "calendar",
        "people",
        "sharing",
        "removed-links",
        "timeline",
      ],
      hidden: ["expenses"],
      removed: ["files"],
    },
  });

  // A hidden view still opens from its address, on the strip while shown;
  // so does a removed one.
  await page.goto(`/events/${event.id}?view=expenses`);
  await expect(
    page.getByRole("tab", { name: "Expenses", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.goto(`/events/${event.id}?view=files`);
  await expect(
    page.getByRole("tab", { name: "Files", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  if (phone) {
    // The phone's select lists the strip's views, plus the one shown.
    const select = page.getByLabel("Event view", { exact: true });
    await expect(select).toHaveValue("files");
    await select.selectOption("todos");
    expect(await select.locator("option").allTextContents()).not.toContain(
      "Expenses",
    );
  }

  // The strip never wraps: at a narrow width the end folds into one chip
  // that lists the rest, and the current tab stays out of it.
  await page.goto(`/events/${event.id}?view=todos`);
  await page.setViewportSize({ width: 820, height: 800 });
  const chip = page.getByRole("button", { name: /more tabs?$/ });
  await expect(chip).toBeVisible();
  const shown = await stripTabs(page);
  expect(shown).toContain("To-dos");
  expect(shown.length).toBeLessThan(8);
  await chip.click();
  const folded = page.getByRole("menu", { name: /more tabs?$/ });
  await expect(folded).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("fold-chip.png") });
  await folded.getByRole("menuitem", { name: "Timeline", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Timeline", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(await stripTabs(page)).toContain("Timeline");

  // A touch held on a tab opens Manage tabs; a tap still selects. The
  // press is a touch pointer, whichever browser runs the journey, with an
  // id of its own: the browser's mouse pointer is 1, and WebKit reports it
  // leaving the strip when the synthetic touch lands elsewhere.
  const held = page.getByRole("tab", { name: "Overview", exact: true });
  const press = async (kind: "pointerdown" | "pointerup") => {
    const box = await held.boundingBox();
    if (box === null) throw new Error("The Overview tab is not on the strip.");
    await held.dispatchEvent(kind, {
      bubbles: true,
      button: 0,
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height / 2,
      isPrimary: true,
      pointerId: 42,
      pointerType: "touch",
    });
  };
  await press("pointerdown");
  await page.waitForTimeout(700);
  await press("pointerup");
  await expect(manage).toBeVisible();
  await expect(held).not.toHaveAttribute("aria-selected", "true");
  await manage.getByRole("button", { name: "Done", exact: true }).click();
  await expect(manage).toHaveCount(0);
  await press("pointerdown");
  await press("pointerup");
  await held.click();
  await expect(held).toHaveAttribute("aria-selected", "true");

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(chip).toHaveCount(0);
  expect((await stripTabs(page)).length).toBe(8);
});
