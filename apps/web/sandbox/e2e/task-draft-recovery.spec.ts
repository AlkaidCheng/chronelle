import { expect, test } from "@playwright/test";
import { createRecoveryEvent } from "../../e2e/helpers/event-draft-recovery";
import { exerciseTaskRecovery } from "../../e2e/helpers/task-draft-recovery";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("recovers Task creation and edits through offline browser navigation", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await createRecoveryEvent(page);
  await exerciseTaskRecovery(page, testInfo);
  expect(errors).toEqual([]);
});
