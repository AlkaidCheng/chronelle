import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { moreTrigger } from "./helpers/quiet-chrome";
import { setDates } from "./helpers/date-rows";
import { openEventView } from "./helpers/event-view";

// The Chinese strings the journey looks for, as escapes so the spec stays
// ASCII like the rest of the suite.
const hans = {
  language: "\u7b80\u4f53\u4e2d\u6587",
  settings: "\u8bbe\u7f6e",
  languageTime: "\u8bed\u8a00\u4e0e\u65f6\u95f4",
  group: "\u8bed\u8a00",
  navigation: "\u5de5\u4f5c\u533a\u5bfc\u822a",
  people: "\u4f19\u4f34",
  trash: "\u56de\u6536\u7ad9",
  more: "\u66f4\u591a",
  events: "\u6d3b\u52a8",
  views: "\u6d3b\u52a8\u89c6\u56fe",
  files: "\u6587\u4ef6",
  loaded: /\u5df2\u52a0\u8f7d \d+ \u4e2a\u6d3b\u52a8/,
  range: "2030\u5e747\u67083\u65e5 \u81f3 2030\u5e747\u670812\u65e5",
  newTask: "\u65b0\u5efa\u4efb\u52a1",
  addTask: "\u6dfb\u52a0\u4efb\u52a1",
  dueSummary: /^\u622a\u6b62\uff1a/,
  noDate: "\u65e0\u65e5\u671f",
  dueDate: "\u622a\u6b62\u65e5\u671f",
  tomorrow: "\u660e\u5929",
  dueTomorrow: /\uff08\u660e\u5929\uff09\u3002$/,
  search: "\u641c\u7d22",
  addPerson: "\u6dfb\u52a0\u4f19\u4f34",
  newPerson: "\u65b0\u4f19\u4f34",
  addNewPerson: "\u6dfb\u52a0\u65b0\u4f19\u4f34",
  actionsFor: /\u7684\u64cd\u4f5c$/u,
  edit: "\u7f16\u8f91",
  editPerson: "\u7f16\u8f91\u4f19\u4f34",
  name: "\u59d3\u540d",
  thisIsMe: "\u8fd9\u662f\u6211",
  addContact: "\u6dfb\u52a0\u8054\u7cfb\u65b9\u5f0f",
  contactValue: "\u8054\u7cfb\u65b9\u5f0f 1 \u7684\u5185\u5bb9",
  savePerson: "\u4fdd\u5b58\u4f19\u4f34",
  shareEvent: "\u5171\u4eab\u6d3b\u52a8",
  sharingView: "\u5171\u4eab",
  byEmail: "\u901a\u8fc7\u90ae\u7bb1",
  othersInPeople: "\u5176\u4ed6\u4f19\u4f34",
  findObject: "\u67e5\u627e\u5bf9\u8c61",
  historyFor: "Summer vacation\u7684\u5386\u53f2",
  objectHistory: "\u5bf9\u8c61\u5386\u53f2",
  closeHistory: "\u5173\u95ed\u5386\u53f2",
  searchAndCommands: "\u641c\u7d22\u4e0e\u547d\u4ee4",
  findCommand: "\u67e5\u627e\u547d\u4ee4",
  discard: "\u653e\u5f03",
};
const hant = {
  language: "\u7e41\u9ad4\u4e2d\u6587",
  settings: "\u8a2d\u5b9a",
  languageTime: "\u8a9e\u8a00\u8207\u6642\u9593",
  group: "\u8a9e\u8a00",
  system: "\u8ddf\u96a8\u7cfb\u7d71",
  events: "\u6d3b\u52d5",
  views: "\u6d3b\u52d5\u6aa2\u8996",
  files: "\u6a94\u6848",
};

/**
 * Opens Settings from the profile menu, its Language & time section, and
 * checks a radio of the Language group, all by their names in the current
 * language. The page changes language in place; the caller returns to
 * wherever the journey continues.
 */
async function chooseLanguage(
  page: Page,
  names: { settings: string; languageTime: string; group: string },
  language: string,
) {
  await page.getByRole("button", { name: /^Event planner/ }).click();
  await page
    .getByRole("menuitem", { name: names.settings, exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings$/u);
  await page
    .getByRole("link", { name: names.languageTime, exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings\/language$/u);
  // The choice is kept on the account; a page opened before that write
  // lands would adopt the account's previous language.
  const kept = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().endsWith("/api/auth/me") &&
      response.ok(),
  );
  await page
    .getByRole("group", { name: names.group, exact: true })
    .getByRole("radio", { name: language, exact: true })
    .check();
  await kept;
}

const english = {
  settings: "Settings",
  languageTime: "Language & time",
  group: "Language",
};

test("switches the workspace to Simplified and Traditional Chinese and back @webkit-desktop @webkit-mobile", async ({
  page,
}) => {
  // One walk through every localized surface: longer than the default budget
  // on a loaded WebKit runner.
  test.setTimeout(60_000);
  const email = `locale-${randomUUID()}@example.test`;
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Event planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "New event", exact: true }).click();
  await page.getByLabel("Event name", { exact: true }).fill("Summer vacation");
  const editor = page.getByRole("dialog", { name: "Create an event" });
  await setDates(editor, "2030-07-03", "2030-07-12");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Summer vacation", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".event-date")).toHaveText(
    "Jul 3, 2030 to Jul 12, 2030",
  );

  // Simplified Chinese, chosen in Settings: the document and the rail
  // change in place, and the event page reads its strip and dates in it.
  const eventUrl = page.url();
  await chooseLanguage(page, english, hans.language);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  await expect(
    page.getByRole("heading", { level: 1, name: hans.settings, exact: true }),
  ).toBeVisible();
  const rail = page.getByRole("navigation", { name: hans.navigation });
  await expect(rail).toContainText(hans.people);
  await moreTrigger(page).click();
  await expect(
    page.getByRole("menu", { name: hans.more, exact: true }),
  ).toContainText(hans.trash);
  await page.keyboard.press("Escape");
  await page.goto(eventUrl);
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

  // The editors and pages read in the language too: the Due control of a
  // new task takes "tomorrow" typed in Chinese, and Trash, Search, History,
  // and the command palette open in it.
  await page.goto("/tasks");
  await page.getByRole("button", { name: hans.newTask, exact: true }).click();
  const taskEditor = page.getByRole("dialog", { name: hans.addTask });
  await expect(
    taskEditor.locator("summary", { hasText: hans.dueSummary }),
  ).toContainText(hans.noDate);
  await taskEditor.locator("summary", { hasText: hans.dueSummary }).click();
  await taskEditor
    .getByLabel(hans.dueDate, { exact: true })
    .fill(hans.tomorrow);
  await expect(taskEditor.locator(".field-hint").first()).toHaveText(
    hans.dueTomorrow,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: hans.discard, exact: true }).click();
  await page.goto("/trash");
  await expect(
    page.getByRole("heading", { level: 1, name: hans.trash, exact: true }),
  ).toBeVisible();
  await page.goto("/search");
  await expect(
    page.getByRole("heading", { level: 1, name: hans.search, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: hans.findObject, exact: true }),
  ).toBeVisible();
  await page.goto(eventUrl);
  await page
    .getByRole("button", { name: hans.historyFor, exact: true })
    .click();
  await expect(
    page.getByText(hans.objectHistory, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: hans.closeHistory, exact: true })
    .click();
  await page
    .getByRole("button", { name: hans.searchAndCommands, exact: true })
    .click();
  await expect(
    page.getByLabel(hans.findCommand, { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // The event's People view, its Add person dialog, the person editor
  // opened from the card, and the Share view read in the language too.
  await openEventView(page, hans.people);
  await page.getByRole("button", { name: hans.addPerson, exact: true }).click();
  const addPerson = page.getByRole("dialog", {
    name: hans.addPerson,
    exact: true,
  });
  await addPerson.getByLabel(hans.newPerson, { exact: true }).fill("Lin Wei");
  await addPerson
    .getByRole("button", { name: hans.addNewPerson, exact: true })
    .click();
  await expect(addPerson).toHaveCount(0);
  const card = page.getByRole("listitem", { name: "Lin Wei", exact: true });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: hans.actionsFor }).click();
  await page.getByRole("menuitem", { name: hans.edit, exact: true }).click();
  const personEditor = page.getByRole("dialog", {
    name: hans.editPerson,
    exact: true,
  });
  await expect(personEditor.getByLabel(hans.name, { exact: true })).toHaveValue(
    "Lin Wei",
  );
  await expect(personEditor.getByLabel(hans.thisIsMe)).toBeVisible();
  // An email makes the person reachable, so Share lists them among the
  // other people of the workspace.
  await personEditor
    .getByRole("button", { name: hans.addContact, exact: true })
    .click();
  await personEditor
    .getByLabel(hans.contactValue, { exact: true })
    .fill("lin.wei@example.test");
  await personEditor
    .getByRole("button", { name: hans.savePerson, exact: true })
    .click();
  await expect(personEditor).toHaveCount(0);
  await page
    .getByRole("button", { name: hans.shareEvent, exact: true })
    .click();
  // The Sharing view is a box headed by the event's name; its tab and its
  // groups carry the translated vocabulary.
  await expect(
    page.getByRole("tab", { name: hans.sharingView, selected: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Summer vacation" }),
  ).toBeVisible();
  await expect(
    page.getByText(hans.othersInPeople, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(hans.byEmail, { exact: true })).toBeVisible();

  // Traditional Chinese has its own vocabulary, not a conversion.
  await chooseLanguage(page, hans, hant.language);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
  await page.goto("/events");
  await expect(
    page.getByRole("heading", { level: 1, name: hant.events, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Summer vacation/ }).click();
  await expect(
    page.getByRole("tablist", { name: hant.views, exact: true }),
  ).toContainText(hant.files);

  // System follows the browser, which speaks English under test; the
  // account forgets its language with it, so a reload keeps English.
  await chooseLanguage(page, hant, hant.system);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto(eventUrl);
  await expect(
    page.getByRole("tablist", { name: "Event views", exact: true }),
  ).toContainText("Files");
  await expect(page.locator(".event-date")).toHaveText(
    "Jul 3, 2030 to Jul 12, 2030",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("renders the first paint in the browser's language and keeps a chosen one @webkit-desktop @webkit-mobile", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "zh-TW" });
  const page = await context.newPage();
  try {
    await page.goto("/sign-in/development");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "\u958b\u555f\u4f60\u7684\u5de5\u4f5c\u5340",
      }),
    ).toBeVisible();
    // A chosen language wins over the browser's on the next request too;
    // outside a session the chip at the bottom opens the choice as a menu.
    await page
      .getByRole("button", { name: new RegExp(`^${hant.group}\uff1a`, "u") })
      .click();
    await page
      .getByRole("menuitemradio", { name: "English", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("heading", { level: 1, name: "Open your workspace" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
