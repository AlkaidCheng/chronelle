import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { chooseLayout } from "./helpers/component-views";
import { setDue } from "./helpers/date-rows";
import { openEventView } from "./helpers/event-view";
import { expectHorizontalReflow } from "./helpers/page-navigation";
import { accountBlock, openCollection } from "./helpers/quiet-chrome";

// The Chinese strings the journey looks for, as escapes so the spec stays
// ASCII like the rest of the suite.
const hans = {
  people: "\u4f19\u4f34",
  settings: "\u8bbe\u7f6e",
  language: "\u8bed\u8a00",
  simplified: "\u7b80\u4f53\u4e2d\u6587",
};

const settingsDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Settings", exact: true });

/**
 * Opens Settings from the account menu, over the page the journey is on.
 * The menu opens from the keyboard, so every engine has focus on the
 * account block, where closing Settings returns it (a tap in mobile
 * WebKit focuses no button).
 */
async function openSettings(page: Page) {
  await accountBlock(page).focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Account", exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

const historyLength = (page: Page) =>
  page.evaluate(() => window.history.length);

/**
 * An instant as the rows show it under a zone and hour cycle, formatted by
 * the browser's own Intl: engines join the date and the time differently.
 */
function shown(
  page: Page,
  instant: number,
  options: Pick<Intl.DateTimeFormatOptions, "timeZone" | "hourCycle">,
): Promise<string> {
  return page.evaluate(
    ([time, formatOptions]) =>
      new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
        ...formatOptions,
      }).format(new Date(time)),
    [instant, options] as const,
  );
}

/** Chooses a radio whose checked state the page derives from its own state. */
async function choose(page: Page, group: string, name: string) {
  const radio = page
    .getByRole("group", { name: group, exact: true })
    .getByRole("radio", { name, exact: true });
  await radio.click();
  await expect(radio).toBeChecked();
}

test("keeps the language, clock, zone, and week on the account and applies them everywhere @webkit-desktop", async ({
  page,
}) => {
  const email = `settings-${randomUUID()}@example.test`;
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Event planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);

  // A timed task shows the clock and the zone in force.
  await openCollection(page, "Tasks");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add task", exact: true });
  await editor.getByLabel("Task", { exact: true }).fill("Morning standup");
  await setDue(editor, "2031-03-05", "09:30");
  await editor
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  // The instant the browser's wall clock names for the due entered above.
  const dueInstant = await page.evaluate(() =>
    new Date(2031, 2, 5, 9, 30).getTime(),
  );
  const row = page.getByRole("row", { name: /Morning standup/ });
  await expect(row).toContainText(await shown(page, dueInstant, {}));

  // Settings opens from the account menu over Tasks, on General, with the
  // sections listed at the left and the current one marked.
  const settings = await openSettings(page);
  await expect(page).toHaveURL(/\/tasks\?settings=general$/u);
  const sections = settings.getByRole("navigation", {
    name: "Settings",
    exact: true,
  });
  await expect(
    sections.getByRole("button", { name: "General", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  // The rail's profile block carries the email too; the section's facts
  // are the ones under test.
  await expect(
    settings
      .getByRole("region", { name: "General", exact: true })
      .getByText(email, { exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByRole("link", { name: "Change password", exact: true }),
  ).toHaveAttribute("href", "/reset-password");

  // Language: Simplified Chinese words the rail at once; English again
  // keeps the rest of the journey readable, and both are kept on the account.
  await sections
    .getByRole("button", { name: "Language & time", exact: true })
    .click();
  await expect(page).toHaveURL(/\/tasks\?settings=language$/u);
  const language = page.getByRole("group", { name: "Language", exact: true });
  await language.getByRole("radio", { name: hans.simplified }).check();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  await expect(
    page.getByRole("dialog", { name: hans.settings, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".workspace-nav")).toContainText(hans.people);
  await page
    .getByRole("group", { name: hans.language, exact: true })
    .getByRole("radio", { name: "English", exact: true })
    .check();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  // A 24-hour clock changes every time shown, the Now line included.
  const now = page.getByText(/^Now: /);
  await expect(now).toHaveText(/[AP]M$/);
  await choose(page, "Time format", "24-hour");
  await expect(now).toHaveText(/\d{2}:\d{2}$/);
  await expect(now).not.toHaveText(/[AP]M$/);

  // A chosen zone moves the task's clock; the search narrows the list.
  const zone = page.getByRole("combobox", { name: "Time zone", exact: true });
  await expect(zone).toHaveValue("");
  await page
    .getByRole("searchbox", { name: "Search time zones", exact: true })
    .fill("utc");
  await expect(
    zone.getByRole("option", { name: /^UTC \(UTC\+00:00\)$/ }),
  ).toBeAttached();
  await zone.selectOption("UTC");
  await expect(zone).toHaveValue("UTC");

  // The week starts on Monday once chosen, whatever the language says.
  await choose(page, "Week starts on", "Monday");

  // Closing returns to Tasks, whose row already follows the clock and zone.
  await settings
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await expect(settings).toHaveCount(0);
  await expect(page).toHaveURL(/\/tasks$/u);
  await expect(row).toContainText(
    await shown(page, dueInstant, { timeZone: "UTC", hourCycle: "h23" }),
  );
  await chooseLayout(page.locator("main"), "By week");
  await expect(page.locator(".week-day-heading > span").first()).toHaveText(
    "Mon",
  );

  // A reload reads every choice back from the account; the old address
  // opens Language & time over Events.
  await page.goto("/settings/language");
  await expect(page).toHaveURL(/\/events\?settings=language$/u);
  await expect(
    page
      .getByRole("group", { name: "Time format", exact: true })
      .getByRole("radio", { name: "24-hour", exact: true }),
  ).toBeChecked();
  await expect(
    page
      .getByRole("group", { name: "Week starts on", exact: true })
      .getByRole("radio", { name: "Monday", exact: true }),
  ).toBeChecked();
  await expect(zone).toHaveValue("UTC");
  await expect(
    language.getByRole("radio", { name: "English", exact: true }),
  ).toBeChecked();

  // Sign out everywhere ends this session too.
  await sections.getByRole("button", { name: "General", exact: true }).click();
  await page
    .getByRole("button", { name: "Sign out everywhere", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sign-in$/u);
  await page.goto("/events");
  await expect(page).toHaveURL(/\/sign-in$/u);
});

test("opens Settings over an event's view and returns to it as it was left @webkit-desktop @webkit-mobile", async ({
  page,
  request,
}, testInfo) => {
  const email = `settings-over-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Event planner" },
  });
  expect(signedIn.ok()).toBe(true);
  const session = await signedIn.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Autumn gathering" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const task = await request.post(`/api/events/${event.id}/resources`, {
    headers,
    data: {
      commandId: randomUUID(),
      resource: { objectType: "task", displayName: "Book the venue" },
    },
  });
  expect(task.status()).toBe(201);
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Event planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);

  // The event's To-dos, narrowed by a filter, with a mark on its heading
  // that a remount of the page would lose.
  await page.goto(`/events/${event.id}`);
  await openEventView(page, "To-dos");
  const eventUrl = page.url();
  expect(eventUrl).toMatch(/\?view=todos$/u);
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("menuitemradio", { name: "All", exact: true }).click();
  await page.keyboard.press("Escape");
  const filter = page.getByRole("button", {
    name: "Filter: 1 filter",
    exact: true,
  });
  await expect(filter).toHaveClass(/is-active/);
  const heading = page.getByRole("heading", {
    level: 1,
    name: "Autumn gathering",
    exact: true,
  });
  await heading.evaluate((element) => {
    element.dataset.probe = "kept";
  });
  const todos = page.getByRole("tab", { name: "To-dos", exact: true });
  async function expectLeftAsItWas() {
    await expect(settingsDialog(page)).toHaveCount(0);
    await expect(page).toHaveURL(eventUrl);
    await expect(todos).toHaveAttribute("aria-selected", "true");
    await expect(filter).toHaveClass(/is-active/);
    await expect(heading).toHaveAttribute("data-probe", "kept");
    await expect(
      page.getByText("Book the venue", { exact: true }),
    ).toBeVisible();
  }

  // The account menu opens Settings over the event as an entry of its own,
  // on General, with focus on its entry.
  const entries = await historyLength(page);
  const settings = await openSettings(page);
  await expect(page).toHaveURL(`${eventUrl}&settings=general`);
  expect(await historyLength(page)).toBe(entries + 1);
  const sections = settings.getByRole("navigation", {
    name: "Settings",
    exact: true,
  });
  const general = sections.getByRole("button", {
    name: "General",
    exact: true,
  });
  await expect(general).toHaveAttribute("aria-current", "page");
  await expect(general).toBeFocused();
  await expect(
    sections.getByRole("list", { name: "Preferences", exact: true }),
  ).toBeVisible();
  // A space's members are Manage space's, not Settings'.
  await expect(
    sections.getByRole("button", { name: "Members", exact: true }),
  ).toHaveCount(0);
  await expect(
    settings.getByRole("heading", { level: 2, name: "General", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settings-general.png") });

  // Another section replaces the address in place.
  await sections
    .getByRole("button", { name: "Language & time", exact: true })
    .click();
  await expect(page).toHaveURL(`${eventUrl}&settings=language`);
  expect(await historyLength(page)).toBe(entries + 1);
  await expect(
    settings.getByRole("region", { name: "Language & time", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("settings-language.png"),
  });

  // The close control returns to the event's To-dos as they were left,
  // with focus back on the account block.
  await settings
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await expectLeftAsItWas();
  await expect(accountBlock(page)).toBeFocused();

  // Escape closes it the same way.
  await openSettings(page);
  await page.keyboard.press("Escape");
  await expectLeftAsItWas();
  await expect(accountBlock(page)).toBeFocused();

  // Back closes it too, and Forward opens it again.
  await openSettings(page);
  await expect(page).toHaveURL(`${eventUrl}&settings=general`);
  await page.goBack();
  await expectLeftAsItWas();
  await page.goForward();
  await expect(settingsDialog(page)).toBeVisible();
  await expect(page).toHaveURL(`${eventUrl}&settings=general`);
  await page.keyboard.press("Escape");
  await expectLeftAsItWas();

  // The address opens it directly; closing then takes the section out of
  // the address in place.
  await page.goto(`${eventUrl}&settings=appearance`);
  await expect(
    settings.getByRole("heading", {
      level: 2,
      name: "Appearance",
      exact: true,
    }),
  ).toBeVisible();
  const opened = await historyLength(page);
  await settings
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await expect(settings).toHaveCount(0);
  await expect(page).toHaveURL(eventUrl);
  expect(await historyLength(page)).toBe(opened);
  await expect(todos).toHaveAttribute("aria-selected", "true");

  // The old Settings addresses open it over Events.
  await page.goto("/settings/appearance");
  await expect(page).toHaveURL(/\/events\?settings=appearance$/u);
  await expect(
    settings.getByRole("region", { name: "Appearance", exact: true }),
  ).toBeVisible();

  // On the narrowest phone it fills the screen, the sections a row that
  // scrolls sideways within it.
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(settings).toBeVisible();
  await expectHorizontalReflow(page);
  const box = await settings.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(320);
  const appearance = sections.getByRole("button", {
    name: "Appearance",
    exact: true,
  });
  await appearance.scrollIntoViewIfNeeded();
  await expect(appearance).toBeInViewport();
  await expectHorizontalReflow(page);
  await page.screenshot({
    path: testInfo.outputPath("settings-narrow.png"),
  });
});
