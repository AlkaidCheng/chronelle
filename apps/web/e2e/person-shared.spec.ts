import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";

const signIn = async (page: Page, name: string, email: string) => {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
};

test("lists what is shared each way on a person's page and shares an event from it @webkit-desktop", async ({
  page,
  request,
}, testInfo) => {
  const anaEmail = `ana-${randomUUID()}@example.test`;
  const benEmail = `ben-${randomUUID()}@example.test`;
  const account = async (email: string, displayName: string) => {
    const response = await request.post("/api/auth/development/sign-in", {
      data: { email, displayName },
    });
    expect(response.ok()).toBe(true);
    const session = await response.json();
    return { headers: { authorization: `Bearer ${session.accessToken}` } };
  };
  const ana = await account(anaEmail, "Ana");
  const ben = await account(benEmail, "Ben");
  const create = async (
    headers: Record<string, string>,
    path: string,
    data: unknown,
  ) => {
    const response = await request.post(path, { headers, data });
    expect(response.status(), path).toBe(201);
    return response.json();
  };
  const kyoto = await create(ana.headers, "/api/events", {
    displayName: "Kyoto in November",
  });
  const supper = await create(ana.headers, "/api/events", {
    displayName: "Harvest supper",
  });
  const spring = await create(ben.headers, "/api/events", {
    displayName: "Spring cleaning weekend",
  });
  // Ben's card in Ana's workspace: invited from the card, so accepting
  // links it to his account, and the two are friends.
  const card = await create(ana.headers, "/api/persons", {
    displayName: "Ben Okafor",
    nickname: "Ben",
    contacts: [{ kind: "email", value: benEmail }],
  });
  const sent = await create(ana.headers, "/api/friends/invitations", {
    email: benEmail,
    personId: card.id,
  });
  const accepted = await request.post(
    `/api/friends/requests/${sent.id}/accept`,
    {
      headers: ben.headers,
    },
  );
  expect(accepted.status()).toBe(200);
  await create(ana.headers, "/api/shares", {
    resourceId: kyoto.id,
    personId: card.id,
    role: "editor",
  });
  await create(ben.headers, "/api/shares", {
    resourceId: spring.id,
    principalEmail: anaEmail,
    role: "viewer",
  });

  await signIn(page, "Ana", anaEmail);
  await page.goto(`/people/${card.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Ben", exact: true }),
  ).toBeVisible();

  // The Overview's Shared panel: newest first, each way.
  const panel = page.getByRole("region", { name: "Shared", exact: true });
  const rows = panel.getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Spring cleaning weekend");
  await expect(rows.nth(0)).toContainText("viewer");
  await expect(rows.nth(0)).toContainText("Ben shared");
  await expect(rows.nth(1)).toContainText("Kyoto in November");
  await expect(rows.nth(1)).toContainText("editor");
  await expect(rows.nth(1)).toContainText("you shared");
  await expect(
    rows.nth(1).getByRole("link", { name: "Kyoto in November" }),
  ).toHaveAttribute("href", `/events/${kyoto.id}`);
  await page.screenshot({ path: testInfo.outputPath("shared-panel.png") });

  // Share with Ben: pick an event, keep Viewer, Share; the list follows.
  await page
    .getByRole("button", { name: "Share with Ben", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Share with Ben" });
  await expect(dialog.getByLabel("Find an event")).toBeFocused();
  await dialog.getByLabel("Find an event").fill("Harvest");
  await expect(dialog.getByRole("radio")).toHaveCount(1);
  await dialog.getByRole("radio", { name: /Harvest supper/ }).check();
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Harvest supper shared as viewer",
  );
  await page.screenshot({ path: testInfo.outputPath("share-dialog.png") });
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Harvest supper");
  const shares = await request.get(`/api/objects/${supper.id}/shares`, {
    headers: ana.headers,
  });
  expect((await shares.json()).items).toMatchObject([{ role: "viewer" }]);

  // The Shared tab lists the same rows in full.
  await page.getByRole("tab", { name: "Shared", exact: true }).click();
  await expect(page.getByRole("tabpanel").getByRole("listitem")).toHaveCount(3);
});
