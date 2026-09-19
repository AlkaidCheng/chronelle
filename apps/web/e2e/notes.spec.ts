import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { openEventView } from "./helpers/event-view";
import { moveToTrash } from "./helpers/lifecycle";
import { openSearchPage, openTrash } from "./helpers/quiet-chrome";
import { chooseRowAction } from "./helpers/row-menu";

test("keeps notes with an event: the gallery card, the editor, opening in place, history, Trash, and search @webkit-desktop", async ({
  page,
  request,
}, testInfo) => {
  const email = `notes-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Mei Lin" },
  });
  expect(identity.status()).toBe(200);
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Kyoto in November", timezone: "UTC" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Mei Lin");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
  await page.goto(`/events/${event.id}?view=todos`);

  // The gallery offers Notes as a card, on the strip like every view
  // until taken off; the card is a switch, so it reads pressed.
  await page.getByRole("button", { name: "Add a view", exact: true }).click();
  const gallery = page.getByRole("dialog", {
    name: "Add to Kyoto in November",
  });
  const notesCard = gallery.getByRole("button", { name: /^Notes/ });
  await expect(notesCard).toContainText(
    "Free text kept with the event: plans, addresses, what to remember.",
  );
  await expect(notesCard).toHaveAttribute("aria-pressed", "true");
  await gallery.getByRole("button", { name: "Done", exact: true }).click();
  await openEventView(page, "Notes");
  await expect(
    page.getByRole("heading", { level: 2, name: "Notes", exact: true }),
  ).toBeVisible();

  // Add note: the editor takes a title and text with line breaks.
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Note", exact: true });
  await editor.getByLabel("Title").fill("Dinner with the Tanakas");
  await editor
    .getByLabel("Text")
    .fill(
      "Gion, second alley on the left.\nThey booked under Tanaka, 19:00.\nMap: https://maps.example/tanaka-gion.",
    );
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const card = page.locator(".note-card", {
    hasText: "Dinner with the Tanakas",
  });
  await expect(card).toContainText("Gion, second alley on the left.");
  await expect(card).toContainText(/by Mei Lin$/u);
  await expect(card.getByRole("link")).toHaveCount(0);

  // Opened in place, the whole text shows and the address is a link.
  await card
    .getByRole("button", { name: "Dinner with the Tanakas", exact: true })
    .click();
  await expect(
    card.getByRole("link", { name: "https://maps.example/tanaka-gion" }),
  ).toHaveAttribute("href", "https://maps.example/tanaka-gion");
  await page.screenshot({ path: testInfo.outputPath("notes-open.png") });

  // A second note, then Edit through the row menu; history shows two
  // versions, the text as the changed field.
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await editor.getByLabel("Title").fill("What to bring");
  await editor.getByLabel("Text").fill("Coins for the shrines.");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const bring = page.locator(".note-card", { hasText: "What to bring" });
  await chooseRowAction(page, bring, "Edit");
  const edit = page.getByRole("dialog", { name: "Edit note", exact: true });
  await expect(edit.getByLabel("Text")).toHaveValue("Coins for the shrines.");
  await edit
    .getByLabel("Text")
    .fill("Coins for the shrines, a folding umbrella.");
  await edit.getByRole("button", { name: "Save", exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(bring).toContainText("a folding umbrella");
  await chooseRowAction(page, bring, "History");
  const history = page.locator("dialog.history-drawer");
  await expect(history).toBeVisible();
  await expect(history.getByText("Version 2")).toBeVisible();
  await history.getByRole("button", { name: "Compare v1" }).click();
  await expect(
    history.getByRole("region", { name: "Version comparison" }),
  ).toContainText("Text");
  await history.getByRole("button", { name: "Close history" }).click();
  await expect(history).toHaveCount(0);

  // The list orders by title on request.
  const titles = page.locator(".note-card .note-toggle");
  await expect(titles).toHaveText(["What to bring", "Dinner with the Tanakas"]);
  await page.getByRole("button", { name: "Sort", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "By title", exact: true })
    .click();
  await expect(titles).toHaveText(["Dinner with the Tanakas", "What to bring"]);

  // Trash from the row menu; the Trash restores the note to the list.
  await chooseRowAction(page, bring, "Move to Trash");
  await moveToTrash(page, page.getByRole("dialog"));
  await expect(titles).toHaveText(["Dinner with the Tanakas"]);
  await openTrash(page);
  await page
    .getByRole("button", {
      name: "Preview recovery for What to bring",
      exact: true,
    })
    .click();
  const recovery = page.getByRole("dialog");
  await recovery.getByRole("checkbox").check();
  await recovery.getByRole("button", { name: "Confirm recovery" }).click();
  await expect(recovery.getByRole("status")).toContainText(
    "Recovered as version",
  );
  await recovery.getByRole("button", { name: "Close", exact: true }).click();
  await page.goto(`/events/${event.id}?view=notes`);
  await expect(page.locator(".note-card")).toHaveCount(2);

  // Search finds the note by its title, not its text.
  await openSearchPage(page);
  await page.getByLabel("Keywords").fill("Tanakas");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("link", { name: /Dinner with the Tanakas/u }),
  ).toBeVisible();
  await page.getByLabel("Keywords").fill("Gion");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("link", { name: /Dinner/u })).toHaveCount(0);
  expect(errors).toEqual([]);
});
