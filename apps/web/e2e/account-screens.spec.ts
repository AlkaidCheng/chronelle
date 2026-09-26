import { randomUUID } from "node:crypto";

import { expect, test } from "./fixtures";
import { latestCodeFor } from "./helpers/mailbox";

test("creates an account with a username, confirms the code, completes the Welcome step, and signs in by username @webkit-desktop", async ({
  page,
}, testInfo) => {
  const tag = randomUUID().slice(0, 8);
  const email = `mira-${tag}@example.test`;
  const username = `mira-${tag}`;
  const password = "correct horse battery";
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    // WebKit reports a link prefetch cut short by the next navigation as
    // an access control failure; it is not an application error.
    if (/_rsc=.*access control checks/u.test(error.message)) return;
    errors.push(error.message);
  });

  // Create account: email, password, username checked as typed; no name.
  await page.goto("/sign-up");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Create your LivTales account",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  const usernameField = page.getByRole("textbox", { name: "Username" });
  await usernameField.fill("1bad");
  await expect(page.getByRole("status")).toContainText(
    "This username is not valid.",
  );
  await usernameField.fill(username);
  await expect(page.getByRole("status")).toContainText(
    `${username} is available.`,
  );
  await page.screenshot({ path: testInfo.outputPath("sign-up.png") });
  await page.getByRole("button", { name: "Create account" }).click();

  // The code, named for the address, from the mailbox file.
  await expect(page).toHaveURL(/\/verify-email\?email=/u);
  await expect(
    page.getByText(`Enter the six-digit code sent to ${email}.`),
  ).toBeVisible();
  await page.getByLabel("Verification code").fill(await latestCodeFor(email));
  await page.getByRole("button", { name: "Confirm" }).click();

  // Welcome, once: the name, then the workspace.
  await expect(page).toHaveURL(/\/welcome$/u);
  await expect(page.getByText(`@${username}`)).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Language" })).toHaveValue(
    "system",
  );
  await page.screenshot({ path: testInfo.outputPath("welcome.png") });
  await page.getByRole("textbox", { name: "Name" }).fill(`Mira ${tag}`);
  await page.getByRole("combobox", { name: "Clock" }).selectOption("h23");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/events$/u);
  await expect(
    page.getByRole("button", { name: new RegExp(`^Mira ${tag}`) }),
  ).toBeVisible();

  // The Welcome step does not come back; Settings holds the name and clock.
  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/events$/u);
  // The old Settings address opens Settings over Events.
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/events\?settings=general$/u);
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(
    `Mira ${tag}`,
  );
  await page.goto("/events?settings=language");
  await expect(page.getByRole("combobox", { name: "Time format" })).toHaveValue(
    "h23",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);

  // Sign out; sign in by username, in any case, with the same password.
  await page.getByRole("button", { name: new RegExp(`^Mira ${tag}`) }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Sign in to LivTales" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Forgot password?" }),
  ).toHaveAttribute("href", "/reset-password");
  await page
    .getByLabel("Username or email address")
    .fill(username.toUpperCase());
  await page.getByLabel("Password").fill(password);
  await page.screenshot({ path: testInfo.outputPath("sign-in.png") });
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/events$/u);
  await expect(
    page.getByRole("button", { name: new RegExp(`^Mira ${tag}`) }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
