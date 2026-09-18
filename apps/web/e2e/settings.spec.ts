import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { chooseLayout } from "./helpers/component-views";
import { setDue } from "./helpers/due-picker";

// The Chinese strings the journey looks for, as escapes so the spec stays
// ASCII like the rest of the suite.
const hans = {
  people: "\u4f19\u4f34",
  settings: "\u8bbe\u7f6e",
  language: "\u8bed\u8a00",
  simplified: "\u7b80\u4f53\u4e2d\u6587",
};

/** Opens Settings from the profile block's menu and lands on Account. */
async function openSettings(page: Page, name: string) {
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings", exact: true }),
  ).toBeVisible();
}

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
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("link", { name: "Tasks", exact: true })
    .click();
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

  // Settings opens from the profile menu on Account, with the sections
  // listed at the left and the current one marked.
  await openSettings(page, "Event planner");
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  await expect(
    sections.getByRole("link", { name: "Account", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Change password", exact: true }),
  ).toHaveAttribute("href", "/reset-password");

  // Language: Simplified Chinese words the rail at once; English again
  // keeps the rest of the journey readable, and both are kept on the account.
  await sections
    .getByRole("link", { name: "Language & time", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings\/language$/u);
  const language = page.getByRole("group", { name: "Language", exact: true });
  await language.getByRole("radio", { name: hans.simplified }).check();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  await expect(
    page.getByRole("heading", { level: 1, name: hans.settings, exact: true }),
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

  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("link", { name: "Tasks", exact: true })
    .click();
  await expect(row).toContainText(
    await shown(page, dueInstant, { timeZone: "UTC", hourCycle: "h23" }),
  );
  await chooseLayout(page.locator("main"), "By week");
  await expect(page.locator(".week-day-heading > span").first()).toHaveText(
    "Mon",
  );

  // A reload reads every choice back from the account.
  await page.goto("/settings/language");
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
  await sections.getByRole("link", { name: "Account", exact: true }).click();
  await page
    .getByRole("button", { name: "Sign out everywhere", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sign-in$/u);
  await page.goto("/events");
  await expect(page).toHaveURL(/\/sign-in$/u);
});
