import { expect, test } from "@playwright/test";
import { exerciseEventDraftRecovery } from "../../e2e/helpers/event-draft-recovery";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("recovers Event drafts through native offline navigation", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await exerciseEventDraftRecovery(page, testInfo);
  expect(errors).toEqual([]);
});
