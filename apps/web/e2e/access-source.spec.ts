import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { switchWorkspace } from "./helpers/quiet-chrome";
import { chooseRowAction } from "./helpers/row-menu";
import { openEventView } from "./helpers/event-view";

const signIn = async (page: Page, name: string, email: string) => {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
};

const signOut = async (page: Page) => {
  await page.getByRole("button", { name: /^Ben/ }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in/u);
};

const accessLine = (page: Page) => page.locator(".access-line");

test("names where a grantee's access comes from, and nothing on the owner's own records @webkit-desktop", async ({
  page,
  request,
}) => {
  const anaEmail = `ana-${randomUUID()}@example.test`;
  const benEmail = `ben-${randomUUID()}@example.test`;
  const ana = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email: anaEmail, displayName: "Ana" },
    })
  ).json();
  // Ben's account must exist before Ana can share with his address.
  expect(
    (
      await request.post("/api/auth/development/sign-in", {
        data: { email: benEmail, displayName: "Ben" },
      })
    ).ok(),
  ).toBe(true);
  const anaHeaders = { authorization: `Bearer ${ana.accessToken}` };
  const post = async (url: string, data: unknown) => {
    const response = await request.post(url, { headers: anaHeaders, data });
    expect(response.status(), url).toBe(201);
    return response.json();
  };
  // Ana shares one event with Ben as a viewer and another as an owner; a
  // person and a task created inside them inherit that access.
  const trip = await post("/api/events", { displayName: "Kyoto in November" });
  const dinner = await post("/api/events", { displayName: "Kaiseki dinner" });
  const mei = await post("/api/persons", {
    displayName: "Mei Lin",
    permissionScopeId: trip.id,
  });
  await post(`/api/events/${dinner.id}/resources`, {
    commandId: randomUUID(),
    resource: { objectType: "task", displayName: "Book the counter seats" },
  });
  for (const [resourceId, role] of [
    [trip.id, "viewer"],
    [dinner.id, "owner"],
  ] as const)
    await post("/api/shares", { resourceId, principalEmail: benEmail, role });

  const errors: string[] = [];
  page.on("pageerror", (error) => {
    // WebKit reports a link prefetch cut short by the next navigation (the
    // sign-in page's links, while the journey leaves for the development
    // sign-in) as an access control failure; it is not an application error.
    if (/_rsc=.*access control checks/u.test(error.message)) return;
    errors.push(error.message);
  });

  // Ben, in Ana's workspace: the event names its grant, and the person
  // created inside it names the event and links to it.
  await signIn(page, "Ben", benEmail);
  await switchWorkspace(page, ana.workspace.displayName);
  await page.getByRole("link", { name: /Kyoto in November/ }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Kyoto in November" }),
  ).toBeVisible();
  await expect(accessLine(page)).toHaveText("Shared with you by Ana as viewer");
  await expect(accessLine(page).getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Sharing" })).toHaveCount(0);

  await page.goto(`/people/${mei.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Mei Lin" }),
  ).toBeVisible();
  const through = accessLine(page).getByRole("link", {
    name: "Through Kyoto in November, shared by Ana",
  });
  await expect(through).toHaveAttribute("href", `/events/${trip.id}`);
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await through.click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Kyoto in November" }),
  ).toBeVisible();

  // As an owner of the dinner, Ben opens a task's editor: the line names
  // the dinner and reaches its Sharing view.
  await page.goto("/events");
  await page.getByRole("link", { name: /Kaiseki dinner/ }).click();
  await expect(accessLine(page).getByRole("button")).toHaveText(
    "Shared with you by Ana as owner",
  );
  await openEventView(page, "To-dos");
  const row = page.getByRole("row", { name: /Book the counter seats/ });
  await chooseRowAction(page, row, "Edit");
  const editor = page.getByRole("dialog", { name: "Edit task", exact: true });
  const editorLine = editor.getByRole("link", {
    name: "Through Kaiseki dinner, shared by Ana",
  });
  await expect(editorLine).toHaveAttribute(
    "href",
    `/events/${dinner.id}?view=sharing`,
  );
  await editorLine.click();
  await expect(
    page.getByRole("tab", { name: "Sharing", selected: true }),
  ).toBeVisible();
  const accessRow = page.locator(".share-list article", { hasText: "Ben" });
  await expect(accessRow).toContainText(
    "Also this event's pages, to-dos, expenses, files, and earlier versions",
  );

  // Ana's own records carry no line.
  await signOut(page);
  await signIn(page, "Ana", anaEmail);
  await page.getByRole("link", { name: /Kyoto in November/ }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Kyoto in November" }),
  ).toBeVisible();
  await expect(accessLine(page)).toHaveCount(0);
  await page.goto(`/people/${mei.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Mei Lin" }),
  ).toBeVisible();
  await expect(accessLine(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});
