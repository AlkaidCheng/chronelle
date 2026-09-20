import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { moveToTrash } from "./helpers/lifecycle";
import { chooseEventLayout } from "./helpers/quiet-chrome";
import { chooseRowAction } from "./helpers/row-menu";

test("reads each event as one compact card with its own Share and menu, in the grid and the list @webkit-desktop @webkit-mobile", async ({
  page,
  request,
}, testInfo) => {
  const phone = testInfo.project.name.endsWith("-mobile");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const anaEmail = `ana-${randomUUID()}@example.test`;
  const benEmail = `ben-${randomUUID()}@example.test`;
  const ana = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email: anaEmail, displayName: "Ana" },
    })
  ).json();
  const ben = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email: benEmail, displayName: "Ben" },
    })
  ).json();
  const anaHeaders = { authorization: `Bearer ${ana.accessToken}` };
  const sent = await (
    await request.post("/api/friends/invitations", {
      headers: anaHeaders,
      data: { email: benEmail },
    })
  ).json();
  expect(
    (
      await request.post(`/api/friends/requests/${sent.id}/accept`, {
        headers: { authorization: `Bearer ${ben.accessToken}` },
      })
    ).status(),
  ).toBe(200);
  for (const data of [
    {
      displayName: "Kyoto in November",
      startsOn: "2030-11-02",
      endsOn: "2030-11-06",
    },
    { displayName: "A quiet studio weekend" },
  ]) {
    expect(
      (
        await request.post("/api/events", { headers: anaHeaders, data })
      ).status(),
    ).toBe(201);
  }

  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Ana");
  await page.getByLabel("Email").fill(anaEmail);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);

  // The card: the tile, the name, and the dates; no period line, no arrow.
  const kyoto = page.getByRole("link", { name: /Kyoto in November/ });
  await expect(kyoto.locator(".event-date-mark span")).toHaveText("NOV");
  await expect(kyoto.locator(".event-date-mark strong")).toHaveText("2");
  await expect(kyoto).toContainText("Nov 2, 2030 to Nov 6, 2030");
  await expect(kyoto).not.toContainText("Scheduled");
  await expect(kyoto.locator(".card-arrow")).toHaveCount(0);
  const studio = page.getByRole("link", { name: /A quiet studio weekend/ });
  await expect(studio.locator(".event-date-mark strong")).toHaveText("TBD");
  await expect(studio.locator(".event-date-mark span")).toHaveCount(0);
  await expect(studio).toContainText("Date to be decided");
  const heights = await page
    .locator(".event-card")
    .evaluateAll((cards) =>
      cards.map((card) => card.getBoundingClientRect().height),
    );
  expect(new Set(heights.map(Math.round)).size).toBe(1);

  // Share on the card opens the sheet for the whole event.
  const card = page.locator(".event-card-shell", {
    hasText: "Kyoto in November",
  });
  await card.hover();
  await card.getByRole("button", { name: "Share", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Share Kyoto in November" });
  await expect(sheet).toContainText("Everyone here sees the whole event.");
  await expect(sheet).toContainText("Only you see this so far.");
  await sheet.getByRole("button", { name: "Add people", exact: true }).click();
  await sheet
    .getByRole("list", { name: "Friends" })
    .getByRole("checkbox", { name: /Ben/ })
    .check();
  await sheet.getByRole("button", { name: "Share with 1 person" }).click();
  await expect(
    sheet.getByRole("combobox", { name: "Role for Ben" }),
  ).toHaveValue("viewer");
  await sheet.getByRole("button", { name: "Done", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Share", exact: true }),
  ).toBeFocused();
  const kyotoId = (await kyoto.getAttribute("href"))?.split("/").pop() ?? "";
  const grants = await (
    await request.get(`/api/objects/${kyotoId}/shares`, { headers: anaHeaders })
  ).json();
  expect(grants.items).toMatchObject([
    { principal: { displayName: "Ben" }, role: "viewer", scope: null },
  ]);

  // The list layout: the same object as rows in one column.
  if (!phone) {
    await chooseEventLayout(page, "List");
    await expect(page.locator(".event-layout-list .event-card")).toHaveCount(2);
    const rows = await page
      .locator(".event-layout-list .event-card")
      .evaluateAll((cards) =>
        cards.map((card) => {
          const style = window.getComputedStyle(card);
          return [
            style.borderTopWidth,
            style.borderBottomWidth,
            style.borderRadius,
          ];
        }),
      );
    expect(rows).toEqual([
      ["0px", "1px", "0px"],
      ["0px", "1px", "0px"],
    ]);
    await chooseEventLayout(page, "Grid");
  }

  // The menu: Edit event opens the editor as a dialog, History the drawer.
  await chooseRowAction(page, card, "Edit event");
  const editor = page.getByRole("dialog", { name: "Edit event" });
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(
    "Kyoto in November",
  );
  await editor.getByRole("button", { name: "Close event editor" }).click();
  await expect(editor).toHaveCount(0);
  await chooseRowAction(page, card, "History");
  const history = page.locator("dialog.history-drawer");
  await expect(history).toBeVisible();
  await expect(history.getByText(/Kyoto in November/).first()).toBeVisible();
  await history.getByRole("button", { name: "Close history" }).click();
  await expect(history).toHaveCount(0);

  // The menu's Move to Trash takes the event off the list.
  await chooseRowAction(page, card, "Move to Trash");
  await moveToTrash(page, page.getByRole("dialog"));
  await expect(kyoto).toHaveCount(0);
  await expect(studio).toBeVisible();
  expect(errors).toEqual([]);
});
