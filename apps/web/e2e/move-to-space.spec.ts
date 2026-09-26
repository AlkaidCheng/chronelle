import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { workspaceBlock } from "./helpers/quiet-chrome";

const signIn = async (page: Page, name: string, email: string) => {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
};

test("moves an event into a shared space after naming the links it removes @webkit-desktop", async ({
  page,
  request,
}) => {
  const anaEmail = `ana-${randomUUID()}@example.test`;
  const benEmail = `ben-${randomUUID()}@example.test`;
  const account = async (email: string, displayName: string) =>
    (
      await request.post("/api/auth/development/sign-in", {
        data: { email, displayName },
      })
    ).json();
  const ana = await account(anaEmail, "Ana");
  const ben = await account(benEmail, "Ben");
  const bearer = (session: { accessToken: string }) => ({
    authorization: `Bearer ${session.accessToken}`,
  });
  const post = async (
    url: string,
    data: unknown,
    headers: Record<string, string> = bearer(ana),
  ) => {
    const response = await request.post(url, { headers, data });
    expect(response.ok(), url).toBe(true);
    return response.json();
  };

  // Ana plans the wedding in her Personal space: a to-do assigned to Mei
  // Lin's People card and labelled Venue, and Mei Lin linked to the event.
  const wedding = await post("/api/events", { displayName: "Garden wedding" });
  const mei = await post("/api/persons", { displayName: "Mei Lin" });
  const venue = await post("/api/labels", { name: "Venue" });
  await post(`/api/events/${wedding.id}/resources`, {
    commandId: randomUUID(),
    resource: {
      objectType: "task",
      displayName: "Book the photographer",
      assigneeId: mei.id,
      labelIds: [venue.id],
    },
  });
  await post(`/api/objects/${wedding.id}/relations`, {
    relationType: "includes",
    targetObjectId: mei.id,
  });

  // "Our wedding" is Ana's shared space with Ben as an Editor; it already
  // has a Venue label.
  const sent = await post("/api/friends/invitations", { email: benEmail });
  await post(`/api/friends/requests/${sent.id}/accept`, {}, bearer(ben));
  const space = await post("/api/workspaces", { displayName: "Our wedding" });
  const inSpace = { ...bearer(ana), "x-workspace-id": space.id };
  await post(
    "/api/workspaces/current/members",
    { friendId: sent.id, role: "editor" },
    inSpace,
  );
  await post("/api/labels", { name: "Venue" }, inSpace);

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, "Ana", anaEmail);
  await page.getByRole("link", { name: /Garden wedding/ }).click();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveText(
    /^Personal\s*\/\s*Events$/u,
  );

  await page
    .getByRole("button", { name: "Actions for Garden wedding" })
    .click();
  await page.getByRole("menuitem", { name: "Move to space..." }).click();
  const dialog = page.getByRole("dialog", { name: "Move to space" });
  const spaces = dialog.getByRole("radiogroup", { name: "Spaces" });
  await expect(spaces.getByRole("radio", { name: /Personal/ })).toBeDisabled();
  await expect(spaces).toContainText("Here now");
  await expect(
    spaces.getByRole("radio", { name: /Our wedding/ }),
  ).toBeChecked();
  await expect(spaces).toContainText("Owner · 2 members");
  await dialog.getByRole("button", { name: "Continue" }).click();

  // The review names what moves, the links it removes, and the label the
  // to-do carries into the space's own Venue.
  const review = page.getByRole("dialog", { name: "Move to Our wedding" });
  await expect(review).toBeVisible();
  await expect(
    review.getByRole("region", { name: "Moves with it" }),
  ).toContainText("1 to-do");
  const removed = review.getByRole("region", {
    name: "Links the move removes",
  });
  await expect(removed).toContainText(
    "Mei Lin (Person), linked to Garden wedding",
  );
  await expect(removed).toContainText(
    "Book the photographer is no longer assigned to Mei Lin",
  );
  await expect(
    review.getByRole("region", { name: "Stays behind" }),
  ).toContainText("The label Venue joins Our wedding's Venue");
  await expect(
    review.getByRole("region", { name: "Who can see it after" }),
  ).toContainText("Our wedding's 2 members, by their roles");
  await review.getByRole("button", { name: "Move and remove 2 links" }).click();

  // The event opens in its new space, which the breadcrumb and the
  // switcher's block now name, with a notice that offers the old one.
  await expect(
    page.getByText("Moved Garden wedding to Our wedding. Removed 2 links."),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/events/${wedding.id}$`, "u"));
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveText(
    /^Our wedding\s*\/\s*Events$/u,
  );
  await expect(workspaceBlock(page)).toContainText("Our wedding");

  // Ben, a member of the space, reads it there.
  const read = await request.get(`/api/events/${wedding.id}`, {
    headers: { ...bearer(ben), "x-workspace-id": space.id },
  });
  expect(read.status()).toBe(200);
  expect((await read.json()).workspaceId).toBe(space.id);

  // Open Personal returns to its Events, which no longer list the event.
  await page.getByRole("button", { name: "Open Personal" }).click();
  await expect(page).toHaveURL(/\/events$/u);
  await expect(workspaceBlock(page)).toContainText("Personal");
  const personalEvents = await (
    await request.get("/api/events", { headers: bearer(ana) })
  ).json();
  expect(
    personalEvents.items.map((item: { id: string }) => item.id),
  ).not.toContain(wedding.id);
  await expect(page.getByRole("link", { name: /Garden wedding/ })).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
});
