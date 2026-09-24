import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Download } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openEventView } from "./helpers/event-view";

/** The downloaded file's lines, the byte-order mark kept on the first. */
async function linesOf(download: Download): Promise<string[]> {
  const path = await download.path();
  expect(path).not.toBeNull();
  return (await readFile(path as string, "utf8")).split("\r\n");
}

// The CSV writes instants in the shown zone: Kyoto's for a Kyoto plan.
test.use({ timezoneId: "Asia/Tokyo" });

test("exports a view as it is shown: the CSV follows the filter and the PDF prints the view alone @webkit-desktop", async ({
  page,
  request,
}, testInfo) => {
  const email = `export-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Mei Lin" },
  });
  expect(identity.status()).toBe(200);
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Kyoto: in November", timezone: "UTC" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  for (const resource of [
    {
      objectType: "task",
      displayName: "Book the ryokan",
      dueOn: "2030-11-02",
    },
    {
      objectType: "task",
      displayName: "Confirm the garden venue",
      status: "done",
      completedAt: "2030-10-30T09:00:00.000Z",
    },
    {
      objectType: "event",
      displayName: "Lunch, then the market",
      startsAt: "2030-11-03T03:00:00.000Z",
      endsAt: "2030-11-03T04:00:00.000Z",
      location: "Nishiki",
    },
  ]) {
    const response = await request.post(`/api/events/${event.id}/resources`, {
      headers,
      data: { commandId: randomUUID(), resource },
    });
    expect(response.status()).toBe(201);
  }
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    // WebKit reports a link prefetch cut short by the next navigation (the
    // sidebar's collections and the Event's own page, while the journey moves
    // on or prints) as an access control failure; it is not an application
    // error.
    if (/_rsc=.*access control checks/u.test(error.message)) return;
    errors.push(error.message);
  });

  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Mei Lin");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
  await page.goto(`/events/${event.id}?view=todos`);
  await expect(page.getByText("Book the ryokan")).toBeVisible();

  // Export sits at the end of the head row and opens two plain items.
  const exportButton = page.getByRole("button", {
    name: "Export",
    exact: true,
  });
  await exportButton.click();
  const menu = page.getByRole("menu", { name: "Export" });
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Export as PDF",
    "Export data (CSV)",
  ]);
  await page.screenshot({ path: testInfo.outputPath("export-menu.png") });

  // The CSV holds the open task alone, named after the event and the view.
  const todosDownload = page.waitForEvent("download");
  await menu.getByRole("menuitem", { name: "Export data (CSV)" }).click();
  const todos = await todosDownload;
  expect(todos.suggestedFilename()).toMatch(
    /^Kyoto in November - To-dos - \d{4}-\d{2}-\d{2}\.csv$/u,
  );
  const todosLines = await linesOf(todos);
  expect(todosLines[0]).toBe(
    "\uFEFFName,Status,Due date,Due time,Duration (minutes),Repeat,Repeat until,Assignee,Labels,Location,Description,Event",
  );
  expect(todosLines.slice(1)).toEqual([
    "Book the ryokan,todo,2030-11-02,,,,,,,,,Kyoto: in November",
    "",
  ]);

  // Filter: All brings the done task into the list, and so into the file.
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "All", exact: true }).click();
  await expect(page.getByText("Confirm the garden venue")).toBeVisible();
  const allDownload = page.waitForEvent("download");
  await exportButton.click();
  await menu.getByRole("menuitem", { name: "Export data (CSV)" }).click();
  expect(
    (await linesOf(await allDownload))
      .slice(1, -1)
      .map((line) => line.split(",")[0]),
  ).toEqual(["Book the ryokan", "Confirm the garden venue"]);

  // The Calendar's CSV quotes a name with a comma and splits the times,
  // read in the shown zone (03:00Z is noon in Kyoto).
  await openEventView(page, "Calendar");
  await expect(page.getByText("Lunch, then the market")).toBeVisible();
  const calendarDownload = page.waitForEvent("download");
  await exportButton.click();
  await menu.getByRole("menuitem", { name: "Export data (CSV)" }).click();
  const calendar = await calendarDownload;
  expect(calendar.suggestedFilename()).toMatch(/ - Calendar - /u);
  expect((await linesOf(calendar))[1]).toBe(
    '"Lunch, then the market",2030-11-03,12:00,2030-11-03,13:00,no,Nishiki,',
  );

  // Export as PDF prints the page with the document marked, the view alone
  // showing; the marks clear when the dialog closes.
  await page.evaluate(() => {
    window.print = () => {
      document.documentElement.dataset.printed =
        document.documentElement.dataset.printing;
    };
  });
  await exportButton.click();
  await menu.getByRole("menuitem", { name: "Export as PDF" }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-printed",
    "calendar",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-printing",
    "calendar",
  );
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.getByRole("tablist")).toBeHidden();
  await expect(exportButton).toBeHidden();
  await expect(
    page.getByRole("heading", { level: 1, name: "Kyoto: in November" }),
  ).toBeVisible();
  await expect(page.getByText("Lunch, then the market")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("export-print.png"),
    fullPage: true,
  });
  await page.emulateMedia({ media: null });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.locator("html")).not.toHaveAttribute("data-printing");
  await expect(exportButton).toBeVisible();
  expect(errors).toEqual([]);
});
