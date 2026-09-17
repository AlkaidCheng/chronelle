import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { setDates } from "./helpers/range-picker";

// The Chinese strings the journey looks for, as escapes so the spec stays
// ASCII like the rest of the suite.
const hans = {
  language: "\u7b80\u4f53\u4e2d\u6587",
  theme: "\u4e3b\u9898",
  group: "\u8bed\u8a00",
  navigation: "\u5de5\u4f5c\u533a\u5bfc\u822a",
  people: "\u53c2\u4e0e\u8005",
  trash: "\u56de\u6536\u7ad9",
  events: "\u6d3b\u52a8",
  views: "\u6d3b\u52a8\u89c6\u56fe",
  files: "\u6587\u4ef6",
  loaded: /\u5df2\u52a0\u8f7d \d+ \u4e2a\u6d3b\u52a8/,
  range: "2030\u5e747\u67083\u65e5 \u81f3 2030\u5e747\u670812\u65e5",
};
const hant = {
  language: "\u7e41\u9ad4\u4e2d\u6587",
  theme: "\u4e3b\u984c",
  group: "\u8a9e\u8a00",
  system: "\u8ddf\u96a8\u7cfb\u7d71",
  events: "\u6d3b\u52d5",
  views: "\u6d3b\u52d5\u6aa2\u8996",
  files: "\u6a94\u6848",
};

/**
 * Opens the rail's Theme panel by its name in the current language and
 * checks a radio of its Language group. System shares its name with the
 * Mode and Motion groups, so the group scopes the radio.
 */
async function chooseLanguage(
  page: Page,
  theme: string,
  group: string,
  language: string,
) {
  const panel = page.getByRole("dialog", { name: theme, exact: true });
  if (!(await panel.isVisible()))
    await page.getByRole("button", { name: theme, exact: true }).click();
  await expect(panel).toBeVisible();
  await panel
    .getByRole("group", { name: group, exact: true })
    .getByRole("radio", { name: language, exact: true })
    .check();
  await page.keyboard.press("Escape");
}

test("switches the workspace to Simplified and Traditional Chinese and back", async ({
  page,
}) => {
  const email = `locale-${randomUUID()}@example.test`;
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Event planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "New event", exact: true }).click();
  await page.getByLabel("Event name", { exact: true }).fill("Summer vacation");
  await page.getByRole("switch", { name: "Set dates" }).check();
  const editor = page.getByRole("dialog", { name: "Create an event" });
  await setDates(editor, "2030-07-03", "2030-07-12");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Summer vacation", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".event-date")).toHaveText(
    "Jul 3, 2030 to Jul 12, 2030",
  );

  // Simplified Chinese: the document, the rail, the strip, and the dates
  // change in place; the URL does not.
  const eventUrl = page.url();
  await chooseLanguage(page, "Theme", "Language", hans.language);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  expect(page.url()).toBe(eventUrl);
  const rail = page.getByRole("navigation", { name: hans.navigation });
  await expect(rail).toContainText(hans.people);
  await expect(rail).toContainText(hans.trash);
  await expect(
    page.getByRole("tablist", { name: hans.views, exact: true }),
  ).toContainText(hans.files);
  await expect(page.locator(".event-date")).toHaveText(hans.range);
  await expect(
    rail.getByRole("link", { name: hans.events, exact: true }),
  ).toHaveCount(1);
  await page.goto("/events");
  await expect(
    page.getByRole("heading", { level: 1, name: hans.events, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: hans.loaded }),
  ).toBeVisible();
  await expect(page.getByText(hans.range)).toBeVisible();

  // Traditional Chinese has its own vocabulary, not a conversion.
  await chooseLanguage(page, hans.theme, hans.group, hant.language);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
  await expect(
    page.getByRole("heading", { level: 1, name: hant.events, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Summer vacation/ }).click();
  await expect(
    page.getByRole("tablist", { name: hant.views, exact: true }),
  ).toContainText(hant.files);

  // System follows the browser, which speaks English under test.
  await chooseLanguage(page, hant.theme, hant.group, hant.system);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("tablist", { name: "Event views", exact: true }),
  ).toContainText("Files");
  await expect(page.locator(".event-date")).toHaveText(
    "Jul 3, 2030 to Jul 12, 2030",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("renders the first paint in the browser's language and keeps a chosen one", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "zh-TW" });
  const page = await context.newPage();
  try {
    await page.goto("/sign-in/development");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "\u958b\u555f\u4f60\u7684\u5de5\u4f5c\u5340",
      }),
    ).toBeVisible();
    // A chosen language wins over the browser's on the next request too.
    await page
      .getByRole("button", { name: "\u81ea\u8a02\u5916\u89c0", exact: true })
      .click();
    await page
      .getByRole("group", { name: hant.group, exact: true })
      .getByRole("radio", { name: "English", exact: true })
      .check();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("heading", { level: 2, name: "Open your workspace" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
